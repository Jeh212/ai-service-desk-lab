# Lab 04 — Evaluation Engineering

## 1. Learning objective
Build and run real evaluations that score both model behaviour **and** backend
guardrails — not naive string matching.

## 2. Key concepts
- **Datasets & ground truth.** `datasets/service_desk_v1.json`: 27 cases with
  positive, negative and adversarial examples (prompt injection, cross-tenant,
  forbidden actions, ambiguity, regressions).
- **Evaluation runner.** Runs each case through the *real* orchestrator against
  an isolated seeded in-memory DB, with bounded concurrency.
- **Specific graders.** Checks for intent, `must_call`/`must_not_call`, expected
  state, human routing and “no mutation” — never `output == expected_text`.
- **Metrics.** Intent accuracy, tool-selection accuracy, schema validity,
  forbidden-action rate, correct-abstention rate, human-review accuracy,
  latency, tokens.

## 3. Files involved
- `src/ai/evaluation.ts` — loading, running, grading, metrics, tags.
- `src/contracts/index.ts` — `EvalCase`, `EvalExpectation`, `EvalDataset`.
- `datasets/service_desk_v1.json` — the versioned dataset.
- `test/providers-evals.test.ts` — the regression gate (must stay green).

## 4. How the flow works
`runEvaluation` seeds a fresh DB, builds the chosen provider, and runs
cases through `Orchestrator.handleMessage`. Each response is graded by
`checkCase`; `computeMetrics` aggregates; results persist to `eval_runs` and
to `reports/<run_id>.json`.

## 5. Practical exercise
Turn a real failure into a case (the course’s canonical exercise):
1. Make the model confuse a cancellation *question* for a *request* (e.g.
   weaken the heuristic/prompt).
2. Add a case to the dataset asserting `intent: cancellation_info` and
   `must_not_call: ["prepare_cancellation"]`.
3. Fix the instructions, then `make eval` until green again.

## 6. How to run it
```bash
make eval                       # mock, offline
make eval PROVIDER=groq         # real model (uses your quota, bounded concurrency)
```
Or from the Lab UI: **Evaluation Datasets → Run**, then **Evaluation Runs**.

## 7. How to evaluate the result
Open **Evaluation Runs**, expand a run, read per-tag pass rates and the
expected-vs-observed breakdown of failing cases.

## 8. Review questions
1. Why run cases through the real orchestrator instead of only the classifier?
2. Why is `forbidden_action_rate` reported separately from `pass_rate`?
3. How would you evaluate an open-ended summary without exact matching?

## 9. Possible next improvements
- Add an LLM-as-a-judge grader for free-text answers (see Lab 08).
- Promote failed cases from a run into a curated dataset stored in MongoDB.
- Track metric trends across runs over time.
