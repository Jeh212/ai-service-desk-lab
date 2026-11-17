import {
  readFile,
  readdir,
  realpath,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { z } from "zod";
import { DATASETS_DIR, REPORTS_DIR, type Settings } from "../core/config.js";
import { AppError } from "../core/errors.js";
import { id, type Auth } from "../core/security.js";
import {
  EvalDataset,
  type Dataset,
  type Response,
  type EvalCase,
} from "../contracts/index.js";
import { Database } from "../repositories/store.js";
import { Repositories } from "../repositories/repos.js";
import { Services } from "../domain/services.js";
import { seedAll, ORG_ACME, USER_ALICE } from "../seeds.js";
import { Orchestrator } from "./orchestrator.js";
import { buildProvider, type LLMProvider } from "./providers.js";
import { buildRegistry } from "./tools.js";
export interface Check {
  name: string;
  passed: boolean;
  detail: string;
}
export interface CaseResult {
  case_id: string;
  passed: boolean;
  checks: Check[];
  observed_intent: string | null;
  observed_tools: string[];
  observed_state: string | null;
  schema_valid: boolean;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  error: string | null;
}
export interface EvalOptions {
  provider?: "mock" | "groq" | null;
  system_version?: string | null;
  classifier_version?: string | null;
}
export async function loadDataset(file: string): Promise<Dataset> {
  // Only a JSON filename in datasets is accepted; reject path traversal and symlink escapes.
  if (file !== basename(file) || !file.endsWith(".json") || file.includes("\\"))
    throw new AppError("invalid_input", "Invalid dataset filename.");
  try {
    const path = await realpath(resolve(DATASETS_DIR, file));
    if (dirname(path) !== (await realpath(DATASETS_DIR)))
      throw new Error("Outside datasets");
    return EvalDataset.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    throw new AppError(
      "invalid_input",
      `Dataset '${file}' was not found or is invalid.`,
    );
  }
}
export async function listDatasets() {
  const datasets = [];
  for (const file of (await readdir(DATASETS_DIR))
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    try {
      const d = await loadDataset(file);
      datasets.push({
        file,
        name: d.name,
        version: d.version,
        cases: d.cases.length,
      });
    } catch {
      /* Invalid local datasets are omitted. */
    }
  }
  return { datasets, dir: DATASETS_DIR };
}
export function checkCase(
  test: z.infer<typeof EvalCase>,
  response: Response,
): CaseResult {
  const expected = test.expected,
    checks: Check[] = [],
    tools = response.trace
      .filter((s) => s.step.startsWith("tool:") && s.status === "ok")
      .map((s) => s.step.slice(5));
  const check = (name: string, passed: boolean, detail: string) =>
    checks.push({ name, passed, detail });
  if (expected.intent !== null)
    check(
      "intent",
      response.intent?.intent === expected.intent,
      `expected=${expected.intent} got=${response.intent?.intent}`,
    );
  if (expected.needs_clarification !== null)
    check(
      "needs_clarification",
      (response.intent?.needs_clarification ?? false) ===
        expected.needs_clarification,
      `expected=${expected.needs_clarification} got=${response.intent?.needs_clarification}`,
    );
  for (const tool of expected.must_call)
    check(`must_call:${tool}`, tools.includes(tool), `observed=${tools}`);
  for (const tool of expected.must_not_call)
    check(`must_not_call:${tool}`, !tools.includes(tool), `observed=${tools}`);
  if (expected.expected_state !== null)
    check(
      "state",
      response.state === expected.expected_state,
      `expected=${expected.expected_state} got=${response.state}`,
    );
  if (expected.must_route_human !== null) {
    const routed =
      response.state === "human_review" || response.review_id !== null;
    check(
      "route_human",
      routed === expected.must_route_human,
      `routed=${routed}`,
    );
  }
  if (expected.must_not_mutate) {
    const mutated =
      response.proposal !== null || response.state === "action_completed";
    check("no_mutation", !mutated, `mutated=${mutated}`);
  }
  // A syntactically valid fallback must not conceal invalid model classification.
  const schema_valid =
    response.intent !== null &&
    !response.trace.some(
      (s) => s.step === "intent_classification" && s.status === "abstained",
    );
  return {
    case_id: test.id,
    passed: checks.every((c) => c.passed) && schema_valid,
    checks,
    observed_intent: response.intent?.intent ?? null,
    observed_tools: tools,
    observed_state: response.state,
    schema_valid,
    latency_ms: 0,
    prompt_tokens: null,
    completion_tokens: null,
    error: null,
  };
}
const rate = (n: number, d: number) =>
  d ? Math.round((n / d) * 10000) / 10000 : null;
export function computeMetrics(dataset: Dataset, results: CaseResult[]) {
  const total = results.length,
    passed = results.filter((r) => r.passed).length;
  const measured = (
    predicate: (e: Dataset["cases"][number]["expected"]) => boolean,
    success: (r: CaseResult) => boolean,
  ) => {
    const selected = dataset.cases
      .map((c, i) => ({ c, r: results[i]! }))
      .filter(({ c }) => predicate(c.expected));
    return rate(selected.filter(({ r }) => success(r)).length, selected.length);
  };
  const hasPass = (r: CaseResult, name: string) =>
    r.checks.some((c) => c.name === name && c.passed);
  return {
    total,
    passed,
    failed: total - passed,
    pass_rate: rate(passed, total) ?? 0,
    intent_accuracy: measured(
      (e) => e.intent !== null,
      (r) => hasPass(r, "intent"),
    ),
    tool_selection_accuracy: measured(
      (e) => !!(e.must_call.length || e.must_not_call.length),
      (r) =>
        !r.error &&
        r.checks
          .filter(
            (c) =>
              c.name.startsWith("must_call:") ||
              c.name.startsWith("must_not_call:"),
          )
          .every((c) => c.passed),
    ),
    schema_validity_rate: rate(
      results.filter((r) => r.schema_valid).length,
      total,
    ),
    forbidden_action_rate: measured(
      (e) => !!(e.must_not_call.length || e.must_not_mutate),
      (r) =>
        r.checks.some(
          (c) =>
            (c.name.startsWith("must_not_call:") || c.name === "no_mutation") &&
            !c.passed,
        ),
    ),
    correct_abstention_rate: measured(
      (e) => !!e.needs_clarification,
      (r) => hasPass(r, "needs_clarification"),
    ),
    human_review_accuracy: measured(
      (e) => e.must_route_human !== null,
      (r) => hasPass(r, "route_human"),
    ),
    avg_latency_ms: total
      ? Math.round(
          (results.reduce((n, r) => n + r.latency_ms, 0) / total) * 100,
        ) / 100
      : 0,
    total_prompt_tokens: results.reduce(
      (n, r) => n + (r.prompt_tokens ?? 0),
      0,
    ),
    total_completion_tokens: results.reduce(
      (n, r) => n + (r.completion_tokens ?? 0),
      0,
    ),
  };
}
export async function runEvaluation(
  dataset: Dataset,
  settings: Settings,
  options: EvalOptions = {},
  injectedProvider?: LLMProvider,
) {
  const provider =
      injectedProvider ??
      buildProvider({
        ...settings,
        llm_provider: options.provider ?? settings.llm_provider,
      }),
    systemVersion = options.system_version ?? "system-v2",
    classifierVersion = options.classifier_version ?? "classify-v2";
  const results: CaseResult[] = new Array(dataset.cases.length);
  let next = 0;
  async function worker() {
    while (next < dataset.cases.length) {
      const index = next++,
        test = dataset.cases[index]!;
      const start = performance.now();
      try {
        // Each case gets an isolated store, so future mutating evaluations cannot contaminate peers.
        const repos = new Repositories(Database.memory());
        await seedAll(repos);
        const auth: Auth = {
          org_id: test.as_org ?? ORG_ACME,
          user_id: test.as_user ?? USER_ALICE,
          roles: ["customer"],
          correlation_id: id("req"),
        };
        const orch = new Orchestrator(
          provider,
          buildRegistry(),
          new Services(repos),
          settings,
          systemVersion,
          classifierVersion,
        );
        const response = await orch.handleMessage(auth, {
          message: test.input,
        });
        const result = checkCase(test, response);
        const trace = await repos.db
          .get("traces")
          .findOne({ correlation_id: auth.correlation_id });
        result.prompt_tokens = Number(trace?.prompt_tokens ?? 0);
        result.completion_tokens = Number(trace?.completion_tokens ?? 0);
        result.latency_ms = performance.now() - start;
        results[index] = result;
      } catch {
        results[index] = {
          case_id: test.id,
          passed: false,
          checks: [
            {
              name: "no_exception",
              passed: false,
              detail: "Evaluation case failed.",
            },
          ],
          observed_intent: null,
          observed_tools: [],
          observed_state: null,
          schema_valid: false,
          latency_ms: performance.now() - start,
          prompt_tokens: null,
          completion_tokens: null,
          error: "Evaluation case failed.",
        };
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(settings.eval_concurrency, dataset.cases.length) },
      worker,
    ),
  );
  const by_tag: Record<
    string,
    { total: number; passed: number; pass_rate: number }
  > = {};
  dataset.cases.forEach((test, index) => {
    for (const tag of test.tags) {
      const b = (by_tag[tag] ??= { total: 0, passed: 0, pass_rate: 0 });
      b.total++;
      if (results[index]!.passed) b.passed++;
      b.pass_rate = rate(b.passed, b.total) ?? 0;
    }
  });
  return {
    run_id: id("run"),
    dataset_name: dataset.name,
    dataset_version: dataset.version,
    provider: provider.name,
    model: provider.model,
    prompt_version: systemVersion,
    created_at: new Date().toISOString(),
    metrics: computeMetrics(dataset, results),
    results,
    by_tag,
  };
}
export async function saveReport(
  report: Awaited<ReturnType<typeof runEvaluation>>,
) {
  await mkdir(REPORTS_DIR, { recursive: true });
  const path = resolve(REPORTS_DIR, `${report.run_id}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + "\n");
  return path;
}
