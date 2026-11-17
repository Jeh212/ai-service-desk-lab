# Lab 01 — AI Product Engineering Lifecycle

## 1. Learning objective
Understand the end-to-end shape of a reliable LLM feature: where the model sits,
what the backend owns, and how failures are contained — before touching any
single component in depth.

## 2. Key concepts
- **Problem & scope.** A support assistant that can *read* account data and
  *prepare* sensitive actions, but never performs irreversible operations on its
  own authority.
- **Separation of responsibilities.** The LLM proposes; deterministic backend
  code decides and executes. Contracts cross the boundary; domain models stay
  behind it.
- **Failure boundaries.** Every step can fail safely into an explained,
  non-mutating state. *A technical failure is never authorization to act.*
- **Demo identity.** The backend issues a signed session token; the client never
  asserts its own `org_id`/`user_id`.

## 3. Files involved
- `src/app.ts` — app factory, lifespan, error handler, `/health`.
- `src/core/config.ts` — all configuration via env (no hardcoded models/keys).
- `src/core/errors.ts` — the internal `ErrorCode` catalog and `AppError`.
- `src/core/security.ts` — demo auth + `Auth`.
- `src/ai/orchestrator.ts` — the pipeline that ties everything together.

## 4. How the flow works
`POST /chat/messages` → `verifyToken` verifies the bearer token → `Orchestrator.
handleMessage` classifies intent, runs a bounded tool loop through the
dispatcher, resolves a *safe* state, persists messages + a trace, and returns an
`AssistantResponse`. Read the pipeline order in `Orchestrator.handleMessage`.

## 5. Practical exercise
Break a boundary on purpose and watch it stay safe:
1. Read the malicious-model test in `test/dispatcher-orchestrator.test.ts`.
   It makes a fake provider request `prepare_cancellation` for an information intent.
2. Run `make test`. The dispatcher rejects the request as
   `tool_not_available_in_state`; no proposal is created.
3. Temporarily remove the dispatcher state check and rerun that test. It should
   fail. Restore the check. The mock itself filters its plan against the offered
   tools, so editing only its plan does not bypass this guard.

## 6. How to run it
```bash
make up && make seed
make api            # terminal A
make web            # terminal B
make test           # offline, no API key
```

## 7. How to evaluate the result
`make eval` prints intent accuracy, tool-selection accuracy, forbidden-action
rate, etc. A healthy baseline on mock is 100% pass with 0 forbidden actions.

## 8. Review questions
1. Where, exactly, is the final cancellation executed, and why can the model not
   call it?
2. What makes the demo auth more trustworthy than a client-sent `userId`?
3. Name three distinct states the assistant can end a turn in, and when each is
   chosen.

## 9. Possible next improvements
- Replace demo auth with a real OIDC provider behind the same `Auth`.
- Add rate limiting at the API edge (request bodies are already size-limited).
- Emit structured audit events to an external sink.
