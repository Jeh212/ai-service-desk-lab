# AI Service Desk Lab

A hands-on laboratory for **shipping reliable, safe LLM features end-to-end**. It
is a working support-desk product for a fictional SaaS company: customers chat
with an AI assistant to view subscriptions, understand policies, cancel plans
(safely), ask billing questions and request refunds — plus an **AI Engineering
Lab** to inspect and experiment with every internal component.

Built to study: AI contracts, intent classification, tool calling, a guarded
tool dispatcher, deterministic business rules, human-in-the-loop, evaluation
engineering, observability and failure boundaries.

> **Provider:** GroqCloud is the real provider; a deterministic **mock provider**
> runs the entire system offline with no API key. Everything — tool calling,
> cancellations, evaluations — works in mock mode first.

---

## Architecture at a glance

```
Browser (Next.js)
   │  bearer session token (issued by backend, never a client-asserted id)
   ▼
FastAPI  ──►  Orchestrator ──►  Intent classifier ──►  Tool dispatcher ──►  Domain services
   │               │                   │                      │                    │
   │               │                   │                      │                    ▼
   │               │                   │                      │             MongoDB (source of truth)
   │               ▼                   ▼                      ▼
   │           Trace / Observability   LLMProvider (mock | groq)   Tool registry (JSON Schemas)
   ▼
Error boundaries + internal error codes
```

The pipeline every message follows (visible in the **Trace Viewer**):

```
User Message → Intent Classification → Tool Call Requested → Args Validation
→ Tool Execution → Business Rule Evaluation → Assistant Response
```

**Key safety invariant:** the model can only *prepare* a cancellation. The final
cancellation is a deterministic, explicitly-confirmed backend operation the model
cannot call. A cancellation *question* can never reach the cancellation tool.

---

## Tech stack

| Layer     | Choice                                                            |
|-----------|-------------------------------------------------------------------|
| Frontend  | Next.js 14 (App Router), TypeScript strict, Tailwind, Zod         |
| Backend   | Python 3.12, FastAPI, Pydantic v2, PyMongo **async**              |
| Database  | MongoDB 7 (Docker, persistent volume)                             |
| LLM       | `GroqLLMProvider` (official `groq` SDK) + `MockLLMProvider`       |
| Tooling   | uv, Ruff, Pytest                                                  |

### Why MongoDB + PyMongo (not Prisma / SQLite)

- **MongoDB local** is the source of truth, accessed from Python with **PyMongo
  Async** — no extra Node.js layer just to reach the database.
- **Prisma’s Python client is deprecated/unmaintained**, so it is *not* used in
  the core. Prisma could be added later purely as an optional, separate study
  module; it is not part of this architecture.
- **SQLite** would be simpler but misses the document model, multi-tenant
  querying and indexing patterns the labs teach. It remains a reasonable
  alternative for a single-file variant.

The repository code uses a thin `DocStore` abstraction with two backends —
`MongoStore` (real) and `MemoryStore` (offline tests/evals) — so the identical
service code runs in both.

---

## Prerequisites

- Docker (Desktop or Engine)
- Python managed by [uv](https://docs.astral.sh/uv/) (the Makefile uses `uv`)
- Node.js 18+ and npm

## Quick start

```bash
# 0) from the repo root
cp .env.example .env            # defaults work offline (LLM_PROVIDER=mock)

# 1) install deps (backend via uv, frontend via npm)
make install

# 2) start MongoDB
make up

# 3) seed demo data (two tenants, users, plans, policies, KB, a review)
make seed

# 4) run the backend  (terminal A)
make api        # http://127.0.0.1:8000  (docs at /docs)

# 5) run the frontend (terminal B)
make web        # http://localhost:3000
```

Open http://localhost:3000, pick a demo identity (e.g. **alice-acme**) and chat.

> If port **27017** is already in use, set `MONGO_PORT=27018` and update
> `MONGO_URI` host port in `.env`, then `make up` again.

### Using the real Groq provider

```dotenv
# .env
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...            # from https://console.groq.com/keys
GROQ_MODEL=llama-3.1-8b-instant
GROQ_STRUCTURED_MODEL=openai/gpt-oss-20b
```

Restart `make api`. The key is read only by the backend — never sent to the
frontend, logs, datasets or traces. Verify model availability in the
[Groq docs](https://console.groq.com/docs); model ids are configurable and not
hardcoded.

## Everyday commands

| Command        | What it does                                              |
|----------------|-----------------------------------------------------------|
| `make up`      | Start MongoDB (Docker)                                     |
| `make seed`    | Idempotent demo data                                       |
| `make reset`   | Clear collections and re-seed                             |
| `make api`     | FastAPI with reload on :8000                               |
| `make web`     | Next.js dev server on :3000                                |
| `make test`    | Backend tests (offline, mock provider, **no API key**)    |
| `make eval`    | Run evaluations — `make eval PROVIDER=groq` for real runs  |
| `make lint`    | Ruff check/format + frontend typecheck                    |
| `make down`    | Stop containers                                            |

Mongo UI (optional): `docker compose --profile tools up -d mongo-express` → http://localhost:8081

---

## Acceptance walkthrough

With the stack running and seeded, you can:

1. Open **Chat**, send *“How does cancellation work?”* → informational answer,
   **no** cancellation prepared (safety).
2. Send *“I want to cancel my subscription now”* → intent `cancel_subscription`,
   tools `get_subscription` + `prepare_cancellation`, state
   **awaiting_confirmation** with the exact terms.
3. Click **Confirm cancellation** → backend revalidates and executes; state
   **action_completed** with an audit reference. **My subscription** now shows
   *cancelled*.
4. Sign in as **bob-acme** and try to cancel → nothing mutates (already
   cancelled): a studied failure boundary.
5. Send *“I’d like a refund”* → routed to **human review**. Sign in as
   **dave-acme** (staff) → approve/reject in **Human Review**.
6. **Evaluation Datasets** → *Run on mock* → 100% pass; inspect in
   **Evaluation Runs**. Run on Groq to compare a real model.
7. **Trace Viewer** → open the request and read each step’s status/duration.
8. **Observability** → tokens, latency, estimated cost, most-used tools.
9. `make test` passes without any LLM API key.

---

## What is implemented vs planned

**Implemented and tested** (offline, mock provider, 50 passing tests + a 27-case
eval at 100% on mock, and verified live against MongoDB):
chat + confirmation flow, intent classification, AI contracts, tool registry &
dispatcher with full guard rails, deterministic cancellation (idempotent,
expiring, user-bound proposals), human-in-the-loop, deterministic knowledge
retrieval, evaluation runner + metrics, structured traces & observability,
demo auth with signed tokens, multi-tenant isolation.

**Implemented, not fully verified here:** real GroqCloud calls (the provider,
retries/429/timeout handling and the Groq-mode eval path are implemented; verify
with your own `GROQ_API_KEY`).

**Planned for later labs (interfaces prepared, no dead code):** semantic
retrieval / vector RAG, LLM-as-a-judge graders, model-comparison dashboards,
additional providers (OpenAI-compatible/local), promoting failed eval cases into
stored datasets. See `docs/learning/` roadmaps.

---

## Repository layout

```
ai-service-desk-lab/
├── apps/
│   ├── api/   FastAPI backend (app/ + tests/)
│   └── web/   Next.js frontend (src/)
├── datasets/  versioned evaluation datasets (JSON)
├── docs/learning/  Lab 01–08 study guides
├── infra/mongodb/  Docker init script
├── docker-compose.yml, .env.example, Makefile
```

See `apps/api/README.md` for backend specifics and `docs/learning/` for the
guided labs.

## Troubleshooting

- **Login fails / empty data** → run `make seed` (needs `make up` first).
- **Port 27017 taken** → set `MONGO_PORT`/`MONGO_URI` in `.env` (see above).
- **`mongo: false` in `/health`** → MongoDB isn’t up or `MONGO_URI` is wrong.
- **Groq errors** → check `GROQ_API_KEY` and model availability; the app falls
  back safely and you can always switch `LLM_PROVIDER=mock`.
- **Frontend can’t reach API** → set `NEXT_PUBLIC_API_BASE` in `apps/web/.env.local`.
# ai-service-desk-lab
