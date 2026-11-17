# Lab 06 — Tool Calling & Agents

## 1. Learning objective
Implement the full tool-calling cycle with a guarded dispatcher, and build a
*bounded* agent loop with human-in-the-loop — autonomy with hard limits.

## 2. Key concepts
- **Tool definitions.** Each tool declares name, model-facing description, arg
  schema, result shape, handler, required roles and possible errors.
- **Registry + dispatcher.** The dispatcher runs an ordered gauntlet: find →
  availability-in-state → validate args → authorize → execute → record → return.
- **Agent loop.** model ↔ dispatcher, bounded by `LLM_MAX_TOOL_ITERATIONS` and a
  per-request tool budget.
- **Deterministic workflows for risk.** Cancellation is prepare → confirm →
  execute; the model owns none of the execution.
- **Human-in-the-loop.** `request_human_review` routes refunds/uncertainty to a
  staff queue.

## 3. Files involved
- `src/ai/tools.ts` — definitions, handlers, `buildRegistry`.
- `src/ai/tools.ts` — the 7-step guarded path.
- `src/ai/tools.ts` — argument validation + JSON Schema.
- `src/ai/orchestrator.ts` — bounded loop and confirmation; `src/ai/intents.ts` — `ALLOWED_TOOLS`.
- `src/domain/services.ts` — deterministic cancellation.

## 4. How the flow works
Per intent, `ALLOWED_TOOLS` restricts the tool set offered to the model. The loop
appends the assistant’s tool-call turn and each tool result back into the
message list until a final answer (or a limit). `prepare_cancellation` only
produces a proposal; `Orchestrator.confirm` executes deterministically.

## 5. Practical exercise
Exercise the guard rails:
1. In the **Tool Registry**, read each tool’s roles and possible errors.
2. Write a unit test (see `test/dispatcher-orchestrator.test.ts`) that calls
   `get_billing_history` with `limit=999` and assert `tool_args_invalid`.
3. Add a new read-only tool (e.g. `get_plan_catalog`), register it, allow it for
   an intent, and add an eval case asserting it’s called.

## 6. How to run it
```bash
make test          # dispatcher + cancellation tests
make api           # http://localhost:3000/lab/tools
```

## 7. How to evaluate the result
`tool_selection_accuracy` and `forbidden_action_rate` in `make eval` reflect tool
behaviour. The duplicate/expired/binding cancellation tests prove idempotency.

## 8. Review questions
1. List the dispatcher’s ordered checks and why order matters.
2. Why is `prepare_cancellation` unreachable for a `cancellation_info` intent,
   even if the model asks for it?
3. What stops a proposal from being confirmed twice, or by another user?

## 9. Possible next improvements
- Add tool-call concurrency within a turn (with care).
- Parameterize per-tool timeouts and per-intent tool budgets.
- A richer approval workflow (multi-step staff sign-off).
