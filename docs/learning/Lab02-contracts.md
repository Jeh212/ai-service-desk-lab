# Lab 02 — AI Contracts

## 1. Learning objective
Make the model’s inputs and outputs *explicit and validated*, and learn to
distinguish four different kinds of validity.

## 2. Key concepts
- **Input vs output contracts.** `ChatMessageInput` in; `IntentClassification`,
  `ToolCall`, `ToolResult`, `CancellationProposal`, `AssistantResponse` out.
- **Four validation layers** (don’t conflate them):
  1. *Structural* — is it valid JSON of the right shape? (`extra="forbid"`)
  2. *Semantic* — are enum values/bounds respected? (`intent ∈ enum`, `0≤conf≤1`)
  3. *Business rule* — is the action allowed given policy/state? (domain services)
  4. *Authorization* — may this principal do it? (`AuthContext`, tool roles)
- **Versioning.** Every AI contract carries `contract_version` so logs/traces/
  eval reports stay interpretable over time.
- **Validate in the backend even when the provider supports schemas.** JSON that
  parses is not a correct decision.

## 3. Files involved
- `app/contracts/common.py` — `Contract` base (`extra="forbid"`), `CONTRACT_VERSION`.
- `app/contracts/intent.py`, `tools.py`, `cancellation.py`, `assistant.py`,
  `human_review.py`, `evaluation.py`.
- `app/ai/tools/schemas.py` — per-tool argument models + JSON Schema generation.

## 4. How the flow works
The classifier output is parsed with `IntentClassification(**data)`; invalid
output is retried then safely abstained. Tool arguments are validated with the
per-tool `ToolArgs` model inside the dispatcher *before* any handler runs.

## 5. Practical exercise
Open the **Contracts Explorer** in the Lab. Pick `IntentClassification` and study
the valid vs invalid example. Then in a Python shell:
```bash
cd apps/api
uv run python -c "from app.contracts.intent import IntentClassification as I; I(intent='nope')"
```
Watch the `ValidationError`. Now try `I(intent='other', surprise=1)` — extra
fields are forbidden. Explain which validation layer each failure belongs to.

## 6. How to run it
```bash
make api   # then open http://localhost:3000/lab/contracts
```

## 7. How to evaluate the result
`schema_validity_rate` in `make eval` reports how often the model’s structured
output validated. It should be 1.0 on mock.

## 8. Review questions
1. Give one concrete failure for each of the four validation layers.
2. Why keep `AssistantResponse.contract_version` even though the frontend is in
   the same repo?
3. Where would you add a *business-rule* validation that “PRO plans can’t be
   cancelled in their first 7 days”?

## 9. Possible next improvements
- Emit JSON Schemas to the frontend build to generate TS types (OpenAPI codegen).
- Add contract migration notes when bumping `CONTRACT_VERSION`.
