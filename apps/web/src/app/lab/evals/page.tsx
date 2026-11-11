"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";

export default function EvalRunsPage() {
  const runs = useAsync(() => api.evalRuns(), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useAsync(
    () => (openId ? api.evalRun(openId) : Promise.resolve(null)),
    [openId],
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Evaluation Runs" subtitle="History of runs. Open one to inspect failures." />
      {runs.loading && <p className="text-sm text-muted">Loading…</p>}
      {runs.data && runs.data.runs.length === 0 && (
        <Empty>No runs yet. Launch one from Evaluation Datasets.</Empty>
      )}
      {runs.data?.runs.map((r: any) => (
        <Card key={r.run_id}>
          <button
            onClick={() => setOpenId(openId === r.run_id ? null : r.run_id)}
            className="flex w-full items-center justify-between text-left"
          >
            <div>
              <div className="text-sm">
                {r.dataset_name} v{r.dataset_version} ·{" "}
                <span className="mono text-xs text-muted">
                  {r.provider}:{r.model}
                </span>
              </div>
              <div className="text-xs text-muted">
                {new Date(r.created_at).toLocaleString()} · prompt {r.prompt_version}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={r.metrics.pass_rate === 1 ? "ok" : r.metrics.pass_rate >= 0.8 ? "pending" : "error"}>
                {Math.round(r.metrics.pass_rate * 100)}% pass
              </Badge>
              <span className="text-xs text-muted">{r.metrics.total} cases</span>
            </div>
          </button>

          {openId === r.run_id && detail.data && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(detail.data.by_tag).map(([tag, b]: any) => (
                  <Badge key={tag} tone={b.pass_rate === 1 ? "ok" : "pending"}>
                    {tag}: {Math.round(b.pass_rate * 100)}%
                  </Badge>
                ))}
              </div>
              <div className="rounded-lg border border-border bg-panel2 p-2">
                {detail.data.results
                  .filter((c: any) => !c.passed)
                  .map((c: any) => (
                    <div key={c.case_id} className="border-b border-border py-1.5 text-xs last:border-0">
                      <span className="mono text-danger">{c.case_id}</span> — intent{" "}
                      <span className="mono">{c.observed_intent}</span>, state{" "}
                      <span className="mono">{c.observed_state}</span>, tools{" "}
                      <span className="mono">[{c.observed_tools.join(", ")}]</span>
                      <div className="text-muted">
                        failed: {c.checks.filter((x: any) => !x.passed).map((x: any) => x.name).join(", ")}
                      </div>
                    </div>
                  ))}
                {detail.data.results.every((c: any) => c.passed) && (
                  <div className="py-2 text-center text-xs text-accent2">All cases passed ✓</div>
                )}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
