# Lab 03 — Prompt Engineering

## 1. Learning objective
Treat prompts as versioned assets, and learn to fix a behaviour regression
through the prompt — then prove the fix with evaluation.

## 2. Key concepts
- **System instructions** encode the safety rules (prepare-not-execute, route
  refunds to humans, info ≠ action).
- **Templates + few-shot.** The classifier prompt injects the versioned intent
  definitions and a few-shot block targeting the hardest boundary.
- **Prompt versioning.** `system-v1`/`system-v2`, `classify-v1`/`classify-v2`.
- **Prompt regressions.** A prompt change can silently worsen behaviour; evals
  are the guardrail.

## 3. Files involved
- `app/ai/prompts/library.py` — versioned prompts, few-shot, builders.
- `app/ai/intents/definitions.py` — the semantic intent descriptions (versioned).
- `app/ai/intents/heuristics.py` — the mock’s deterministic stand-in for a model.

## 4. How the flow works
`Orchestrator._classify` calls `library.build_classification_messages(text,
version)`. The **Prompt Playground** lets you run two system-prompt versions on
the same input, side by side, and compare intent, state and the trace.

## 5. Practical exercise
Reproduce and fix the classic confusion:
1. In the Playground, run *“I want to cancel now but first, how does it work?”*
   with `system-v2`. It should resolve to `cancellation_info` (safe).
2. Edit `definitions_for_prompt`/the classifier template to sharpen the
   info-vs-action rule, bump to a `classify-v3`, and wire it in.
3. Add a new dataset case capturing the behaviour you want, then `make eval`.

## 6. How to run it
```bash
make api   # http://localhost:3000/lab/playground
```
With `LLM_PROVIDER=groq`, the same Playground exercises the real model.

## 7. How to evaluate the result
Run `make eval` before and after; watch `intent_accuracy` and
`correct_abstention_rate`. A good change moves a metric up without dropping
another.

## 8. Review questions
1. Why do intent *descriptions* live in a file instead of inline in the prompt?
2. What’s the risk of adding more few-shot examples, and how would you detect it?
3. How does prompt *versioning* make a regression debuggable weeks later?

## 9. Possible next improvements
- Store prompt versions in MongoDB with authorship + changelog.
- A/B a prompt change across a dataset and record win-rate per tag.
