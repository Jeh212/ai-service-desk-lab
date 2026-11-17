# TypeScript API

Node.js 22+ / Fastify 5 / Zod / MongoDB Node driver / official `groq-sdk`.
Run commands from the repository root:

```bash
make install
make up
make seed
make api                 # :8000, Swagger UI at /docs, schema at /openapi.json
make test                # offline, no MongoDB or API key
make eval                # isolated mock evaluation
make lint
make build-api
npm start --prefix apps/api
```

Settings load from the root `.env`, then `apps/api/.env`; actual environment
variables take precedence. Source and compiled builds resolve datasets and
reports relative to the repository root, independently of the working directory.
The frontend uses the same routes, snake_case JSON fields and error envelopes.

- `src/contracts/index.ts`: strict runtime contracts and JSON Schemas.
- `src/app.ts`, `src/server.ts`: routes, authentication, lifecycle, CORS and errors.
- `src/core/`: settings, signed demo tokens and error codes.
- `src/repositories/`: typed repositories and interchangeable memory/Mongo stores.
- `src/domain/`: persisted entity schemas and deterministic business rules.
- `src/ai/`: providers, intents, versioned prompts, tools, orchestration, traces, evaluations.
- `src/cli/`: seed, reset and evaluation commands.
- `test/`: Node test runner integration, unit, provider and regression checks.

`createApp({database: Database.memory(), settings})` supports offline API tests
with `app.inject()`. Normal startup connects to MongoDB and ensures indexes.

Real database integration runs against a unique disposable database:

```bash
TEST_MONGO_URI='mongodb://root:example@localhost:27017/?authSource=admin' make test-mongo
```

Never point demo authentication at real customer accounts. Cancellation remains
an educational workflow: it updates the subscription and audit record; it does
not send money through a payment processor. Multi-document writes are not a
transaction on the default standalone MongoDB setup; see the migration notes.
