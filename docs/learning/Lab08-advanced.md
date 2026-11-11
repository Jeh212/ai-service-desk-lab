# Lab 08 — Advanced Experiments

## 1. Learning objective
Explore the extensions: model comparison, fallback strategies, LLM-as-a-judge,
and when (not) to fine-tune or add agentic complexity.

## 2. Key concepts
- **Model comparison.** Run the same dataset across models with identical graders
  and compare metrics.
- **Fallback strategies.** Degrade safely: mock when the provider is down; retry
  with backoff; abstain when uncertain.
- **LLM-as-a-judge.** For open-ended answers, use a model to grade with a rubric
  — carefully, with its own evaluation.
- **Fine-tuning: when to avoid.** Prefer prompts, contracts and tools first;
  fine-tune only with a stable task, a real dataset, and evals proving the need.
- **Bounded autonomy.** Add agent complexity only when a deterministic workflow
  can’t express the task.

## 3. Files involved
- `app/ai/providers/base.py`, `factory.py` — the provider abstraction + switch.
- `app/ai/providers/groq_provider.py`, `mock.py` — two implementations.
- `app/ai/evaluation/runner.py` — `run(provider_name=...)` for comparison.

## 4. How the flow works
`build_provider(settings)` is the single switch. The evaluation runner accepts a
`provider_name`, so the same dataset and graders run against mock or Groq (and,
later, additional providers) for apples-to-apples comparison.

## 5. Practical exercise
Compare two models (needs a Groq key):
1. Set `GROQ_MODEL=llama-3.1-8b-instant`, run `make eval PROVIDER=groq`.
2. Change `GROQ_MODEL` to another available model, run again.
3. Compare runs in **Evaluation Runs**; note where accuracy/latency/abstention
   differ by tag. Decide which model you’d ship and why.

## 6. How to run it
```bash
make eval PROVIDER=groq
```

## 7. How to evaluate the result
Use the per-tag breakdown and latency to justify a model choice. A model that is
more accurate but violates a `safety` case is not shippable.

## 8. Review questions
1. What must be true before fine-tuning is the right lever?
2. How would you evaluate an LLM-as-a-judge so you can trust it?
3. Which parts of this system should stay deterministic no matter how capable the
   model becomes?

## 9. Possible next improvements
- Add an `OpenAICompatibleProvider` and a local-model provider behind `LLMProvider`.
- A model-comparison dashboard page over stored `eval_runs`.
- A judge-based grader with its own calibration dataset.

---

### Where to go next
You now have the full loop:
**User → Input Contract → Intent → LLM → Tool Call → Dispatcher → Domain →
Knowledge/DB → Output Contract → Response**, and in parallel
**Conversation → Observability → Failure → Dataset → Evaluation → Improvement →
Re-evaluation.** Extend any component behind its existing interface.
