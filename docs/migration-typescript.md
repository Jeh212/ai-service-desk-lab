# Python → TypeScript API migration

## Runtime and compatibility

The entire runtime backend is now TypeScript on Node.js 22+. Fastify replaces
FastAPI, Zod replaces Pydantic, the official MongoDB Node driver replaces
PyMongo, and `groq-sdk` replaces the Python Groq client. Python/uv are no longer
needed to install, run, seed, reset, test or evaluate the application.

The frontend routes and response shapes stay compatible: snake_case fields,
ISO timestamps, assistant states, proposal terms, error codes and demo token
format. Existing user, plan, subscription, policy, billing, conversation,
proposal and review documents work with the Node API. Prompts, identities,
seeded data and the 27-case dataset are preserved. JSON schemas exposed in the
Lab now come from the same Zod schemas used to validate requests/model output.

Use `make install`, `make up`, `make seed`, `make api`, `make web` for a fresh
installation. **Do not run `make reset` or `make seed` on an existing database
whose subscription state you want to retain**: seed intentionally restores demo
subscriptions. Stop the old Python API before starting the new API on port 8000.
Keep `DEMO_AUTH_SECRET` unchanged if existing demo tokens should remain valid.

## Intentional corrections

- Both confirmation and decline verify conversation ownership and proposal
  ownership, including cross-tenant cases. Abandonment cannot overwrite an
  executed proposal.
- Compare-and-set writes reject concurrent confirmations, competing proposals
  for the same subscription, and duplicate staff decisions. Message appends use
  MongoDB `$push` rather than read/replace.
- Billing for cancellation is scoped to the subscription and its owner; the
  refund currency comes from the matching charge. Currency ties use Python's
  round-to-even behavior.
- Evaluation dataset names cannot traverse directories or escape via symlinks.
- New evaluation runs are scoped to the initiating organization. Legacy runs
  lacking `org_id` are deliberately hidden; rerun the dataset to create a scoped
  report. Reports written by the CLI remain local files.
- Evaluation cases use separate stores, record actual elapsed time/token usage,
  and count malformed model classification as schema failure even when the
  orchestrator returns a valid fallback response.
- `GROQ_STRUCTURED_MODEL` is used for classification; `GROQ_MODEL` for tool calls.
  Invalid JSON tool arguments fail closed. Provider errors never expose raw
  credential-bearing exception strings.
- Input validation is strict: boolean strings, extra fields, blank chat text,
  invalid provider/prompt selections and invalid limits produce HTTP 422 with
  the standard error envelope. JSON coercion is disabled.
- `LLM_HISTORY_WINDOW=0` sends no prior turns. The mock explains failed tools
  instead of announcing successful cancellation preparation.

## Verification

`make test` covers contracts, original intent examples, authorization, tenant
isolation, cancellation/decline/expiry/concurrency, human review, every existing
HTTP route, OpenAPI, CORS, evaluation APIs and simulated Groq errors.
`make eval` runs the unchanged 27-case dataset. No provider key is needed.
`make lint` checks TypeScript/formatting and the frontend, while
`make build-api` compiles an executable production build.

`TEST_MONGO_URI=... make test-mongo` tests the real driver, indexes, persistence,
concurrent updates and HTTP startup against a disposable database. CI runs this
with MongoDB 7 and also builds the frontend. Real Groq responses require a
configured key and are separate from deterministic SDK transport tests.

## Remaining lab limitations

The default MongoDB is standalone. Cancellation updates the subscription,
proposal and audit in separate operations. Compare-and-set prevents duplicate
execution but is **not a cross-document transaction**: an infrastructure failure
between writes can leave a partially completed action requiring reconciliation.
A production version should use a replica set transaction or a durable workflow
with recovery. Reviews approve/reject a request; no payment refund is executed.
Demo login codes are for local learning, not production authentication.
The observability cost estimate remains a documented placeholder ($0.10/M
combined tokens), not provider pricing.

To roll back, stop Node and restore the previous Git revision. No collection
renaming or destructive data conversion is part of this migration.
