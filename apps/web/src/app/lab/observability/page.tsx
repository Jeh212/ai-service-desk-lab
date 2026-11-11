"use client";

import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Card, PageHeader, Stat } from "@/components/ui";

export default function ObservabilityPage() {
  const { data, loading } = useAsync(() => api.observability(), []);
  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Observability"
        subtitle="Aggregated signals from stored traces. No secrets are ever recorded."
      />
      {loading && <p className="text-sm text-muted">Loading…</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Conversations traced" value={data.conversations_traced} />
            <Stat label="LLM calls" value={data.llm_calls} />
            <Stat label="Tool calls" value={data.tool_calls} />
            <Stat label="Errors" value={data.validation_or_tool_errors} />
            <Stat label="Prompt tokens" value={data.prompt_tokens} />
            <Stat label="Completion tokens" value={data.completion_tokens} />
            <Stat
              label="Est. cost"
              value={`$${Number(data.estimated_cost_usd).toFixed(4)}`}
              hint="placeholder rate"
            />
            <Stat
              label="Total tokens"
              value={data.prompt_tokens + data.completion_tokens}
            />
          </div>

          <Card title="Most-used tools">
            {data.top_tools.length === 0 ? (
              <p className="text-sm text-muted">No tool calls yet.</p>
            ) : (
              <div className="space-y-2">
                {data.top_tools.map(([name, count]: [string, number]) => {
                  const max = data.top_tools[0][1] || 1;
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <span className="mono w-52 shrink-0 text-sm">{name}</span>
                      <div className="h-3 flex-1 overflow-hidden rounded bg-panel2">
                        <div
                          className="h-full bg-accent"
                          style={{ width: `${(count / max) * 100}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-sm text-muted">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
