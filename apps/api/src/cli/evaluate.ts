import { parseArgs } from "node:util";
import { z } from "zod";
import { getSettings } from "../core/config.js";
import { loadDataset, runEvaluation, saveReport } from "../ai/evaluation.js";
try {
  const { values } = parseArgs({
    options: {
      dataset: { type: "string", default: "service_desk_v1.json" },
      provider: { type: "string" },
      "system-version": { type: "string", default: "system-v2" },
      "classifier-version": { type: "string", default: "classify-v2" },
    },
  });
  const report = await runEvaluation(
    await loadDataset(values.dataset),
    getSettings(),
    {
      provider: z.enum(["mock", "groq"]).optional().parse(values.provider),
      system_version: z
        .enum(["system-v1", "system-v2"])
        .parse(values["system-version"]),
      classifier_version: z
        .enum(["classify-v1", "classify-v2"])
        .parse(values["classifier-version"]),
    },
  );
  console.log(JSON.stringify(report.metrics, null, 2));
  for (const r of report.results)
    if (!r.passed)
      console.log(
        r.case_id,
        r.checks.filter((c) => !c.passed),
      );
  console.log(`Report saved: ${await saveReport(report)}`);
  process.exitCode = report.metrics.failed ? 1 : 0;
} catch {
  console.error(
    "Evaluation failed. Check the dataset, options and provider configuration.",
  );
  process.exitCode = 2;
}
