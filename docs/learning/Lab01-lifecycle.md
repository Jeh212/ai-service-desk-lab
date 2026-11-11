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
- `app/main.py` — app factory, lifespan, error handler, `/health`.
- `app/core/config.py` — all configuration via env (no hardcoded models/keys).
- `app/core/errors.py` — the internal `ErrorCode` catalog and `AppError`.
- `app/core/security.py`, `app/core/context.py` — demo auth + `AuthContext`.
- `app/ai/orchestrator.py` — the pipeline that ties everything together.

## 4. How the flow works
`POST /chat/messages` → `get_auth` verifies the bearer token → `Orchestrator.
handle_message` classifies intent, runs a bounded tool loop through the
dispatcher, resolves a *safe* state, persists messages + a trace, and returns an
`AssistantResponse`. Read the pipeline order in `orchestrator.handle_message`.

## 5. Practical exercise
Break a boundary on purpose and watch it stay safe:
1. In `app/ai/providers/mock.py`, temporarily add `prepare_cancellation` to the
   plan for `CANCELLATION_INFO`.
2. Run `make eval`. Case `EVAL-001` / `EVAL-020` should now **fail** on
   `must_not_call:prepare_cancellation`.
3. Observe that even so, the orchestrator’s `ALLOWED_TOOLS` would block the tool
   as `tool_not_available_in_state` (the tool can’t run for an info intent).
   Revert your change.

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
- Replace demo auth with a real OIDC provider behind the same `AuthContext`.
- Add rate limiting and request size limits at the API edge.
- Emit structured audit events to an external sink.
