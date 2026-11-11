"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Card, PageHeader, Stat } from "@/components/ui";

const FLOW = [
  "User Message",
  "Intent Classification",
  "Tool Call Requested",
  "Args Validation",
  "Tool Execution",
  "Business Rule",
  "Assistant Response",
];

export default function LabDashboard() {
  const obs = useAsync(() => api.observability(), []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Engineering Lab"
        subtitle="Inspect and experiment with the real internals of the assistant."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Conversations traced" value={obs.data?.conversations_traced ?? "—"} />
        <Stat label="LLM calls" value={obs.data?.llm_calls ?? "—"} />
        <Stat label="Tool calls" value={obs.data?.tool_calls ?? "—"} />
        <Stat label="Validation/tool errors" value={obs.data?.validation_or_tool_errors ?? "—"} />
      </div>

      <Card title="The pipeline you can study">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {FLOW.map((step, i) => (
            <span key={step} className="flex items-center gap-2">
              <span className="rounded-lg border border-border bg-panel2 px-3 py-1.5">{step}</span>
              {i < FLOW.length - 1 && <span className="text-muted">→</span>}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          ["/lab/intents", "Intent Explorer", "Versioned intent taxonomy + allowed tools."],
          ["/lab/contracts", "Contracts Explorer", "Real Pydantic schemas + valid/invalid examples."],
          ["/lab/tools", "Tool Registry", "Catalog, parameters, permissions, handlers."],
          ["/lab/traces", "Trace Viewer", "Step-by-step view of each request."],
          ["/lab/evals", "Evaluation Runs", "Run datasets on mock or Groq; compare runs."],
          ["/lab/playground", "Prompt / Groq Playground", "Compare prompt versions on the same input."],
          ["/lab/reviews", "Human Review", "Approve/reject escalated cases (staff)."],
          ["/lab/observability", "Observability", "Tokens, latency, cost, top tools."],
          ["/lab/knowledge", "Knowledge Base", "Tenant-scoped articles used for retrieval."],
        ].map(([href, title, desc]) => (
          <Link key={href} href={href}>
            <Card className="h-full transition hover:border-accent">
              <div className="font-medium">{title}</div>
              <div className="mt-1 text-sm text-muted">{desc}</div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
