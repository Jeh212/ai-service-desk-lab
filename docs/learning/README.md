# Learning path — AI Product Engineering

These labs follow the Educative course *AI Product Engineering: Ship Reliable LLM
Features End-to-End* and map each concept to real code in this repository. Each
lab has the same shape:

1. Learning objective
2. Key concepts
3. Files involved
4. How the flow works
5. A practical exercise
6. How to run it
7. How to evaluate the result
8. Three review questions
9. Possible next improvements

Work them in order; each builds on the last.

| Lab | Topic | Core files |
|-----|-------|------------|
| [Lab 01](Lab01-lifecycle.md) | AI Product Engineering lifecycle | `app/main.py`, `app/core/*`, `app/ai/orchestrator.py` |
| [Lab 02](Lab02-contracts.md) | AI contracts | `app/contracts/*` |
| [Lab 03](Lab03-prompts.md) | Prompt engineering | `app/ai/prompts/library.py`, `app/ai/intents/*` |
| [Lab 04](Lab04-evaluation.md) | Evaluation engineering | `app/ai/evaluation/*`, `datasets/*` |
| [Lab 05](Lab05-retrieval.md) | Retrieval & RAG | `app/domain/support/service.py`, `app/repositories/*` |
| [Lab 06](Lab06-tools-agents.md) | Tool calling & agents | `app/ai/tools/*`, `app/ai/orchestrator.py` |
| [Lab 07](Lab07-production.md) | Production AI | `app/ai/observability/*`, `app/core/errors.py` |
| [Lab 08](Lab08-advanced.md) | Advanced experiments | `app/ai/providers/*`, `app/ai/evaluation/runner.py` |

> Tip: keep `make test` and `make eval` handy — the fastest feedback loop in the
> lab is “change behaviour, run the evals, read what moved.”
