# Lab 05 — Retrieval & RAG

## 1. Learning objective
Add grounded knowledge to answers using **deterministic** retrieval first, and
understand where semantic retrieval would slot in without a rewrite.

## 2. Key concepts
- **Knowledge base** stored in MongoDB, per tenant, with category/version/status.
- **Deterministic retrieval** today: filtered + keyword (`$regex`) queries with
  indexes. No embeddings/vector DB yet — on purpose.
- **Tenant grounding.** One org can never retrieve another org’s documents.
- **KB is context, not truth.** The domain services remain the source of truth;
  the KB informs explanations.

## 3. Files involved
- `app/domain/support/service.py` — `KnowledgeService.search`.
- `app/repositories/repos.py` — `KnowledgeRepo.search` (query + indexes).
- `app/ai/tools/registry.py` — the `search_knowledge_base` tool.
- `app/seeds.py` — seeded articles per tenant.

## 4. How the flow works
For `general_support` (and optionally `cancellation_info`), the model may call
`search_knowledge_base`. The handler calls `KnowledgeService.search`, scoped to
`auth.org_id` and `published=True`, returning the top matches to the model.

## 5. Practical exercise
Study isolation and retrieval quality:
1. In the Lab’s **Knowledge Base**, compare articles as `alice-acme` vs
   `carol-globex` — the sets are disjoint.
2. Ask the assistant (as Carol) a Globex-specific question and confirm only
   Globex content is used.
3. Design (don’t build yet) an embeddings path: where would you add an
   `embedding` field and a vector index, and how would `search` choose between
   keyword and semantic?

## 6. How to run it
```bash
make seed && make api   # http://localhost:3000/lab/knowledge
```

## 7. How to evaluate the result
Add dataset cases that require retrieval and assert `must_call:
["search_knowledge_base"]`. Later, add a *groundedness* grader checking the
answer cites retrieved content.

## 8. Review questions
1. Why start with deterministic retrieval instead of embeddings?
2. How is cross-tenant leakage prevented in `KnowledgeRepo.search`?
3. What failure modes appear once you add semantic retrieval (and how to detect)?

## 9. Possible next improvements
- Add chunking + an embedding column and a MongoDB vector index.
- Hybrid retrieval (keyword + vector) with a re-ranker.
- A groundedness metric in the evaluation runner.
