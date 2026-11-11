"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";

export default function TracesPage() {
  const traces = useAsync(() => api.traces(), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useAsync(
    () => (openId ? api.trace(openId) : Promise.resolve(null)),
    [openId],
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Trace Viewer" subtitle="Each request, step by step, with duration and status." />
      {traces.loading && <p className="text-sm text-muted">Loading…</p>}
      {traces.data && traces.data.traces.length === 0 && (
        <Empty>No traces yet. Send a message in Chat.</Empty>
      )}
      {traces.data?.traces.map((t: any) => (
        <Card key={t.correlation_id}>
          <button
            onClick={() => setOpenId(openId === t.correlation_id ? null : t.correlation_id)}
            className="flex w-full items-center justify-between text-left"
          >
            <div>
              <div className="mono text-sm text-accent">{t.correlation_id}</div>
              <div className="text-xs text-muted">
                {new Date(t.created_at).toLocaleString()} · {t.provider}:{t.model}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <Badge>{t.llm_calls} LLM</Badge>
              <Badge>{t.tool_calls} tools</Badge>
              <Badge>{t.steps} steps</Badge>
            </div>
          </button>

          {openId === t.correlation_id && detail.data && (
            <div className="mt-3">
              <div className="relative border-l-2 border-border pl-4">
                {detail.data.steps.map((s: any, i: number) => (
                  <div key={i} className="relative pb-3">
                    <span
                      className={`absolute -left-[22px] top-1 h-3 w-3 rounded-full ${
                        s.status === "ok"
                          ? "bg-accent2"
                          : s.status === "error"
                            ? "bg-danger"
                            : "bg-warn"
                      }`}
                    />
                    <div className="flex items-center justify-between">
                      <span className="mono text-sm">{s.step}</span>
                      <span className="flex items-center gap-2 text-xs text-muted">
                        <Badge tone={s.status}>{s.status}</Badge>
                        {s.duration_ms.toFixed(1)}ms
                      </span>
                    </div>
                    {s.detail && Object.keys(s.detail).length > 0 && (
                      <div className="mono mt-1 text-xs text-muted">
                        {JSON.stringify(s.detail)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
