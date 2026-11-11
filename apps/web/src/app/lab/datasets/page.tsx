"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

export default function DatasetsPage() {
  const { data, loading } = useAsync(() => api.datasets(), []);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dataset: string, provider: string) {
    setRunning(`${dataset}:${provider}`);
    setResult(null);
    setError(null);
    try {
      setResult(await api.runEval({ dataset, provider }));
    } catch (e: any) {
      setError(e?.message ?? "Run failed");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Evaluation Datasets"
        subtitle="Versioned cases evaluating both model behaviour and backend guardrails."
      />
      {loading && <p className="text-sm text-muted">Loading…</p>}
      {data?.datasets.map((d: any) => (
        <Card key={d.file} title={d.name} right={<Badge>v{d.version}</Badge>}>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted">
              {d.cases} cases · <span className="mono">{d.file}</span>
            </div>
            <div className="flex gap-2">
              <Button tone="ghost" disabled={!!running} onClick={() => run(d.file, "mock")}>
                {running === `${d.file}:mock` ? "running…" : "Run on mock"}
              </Button>
              <Button disabled={!!running} onClick={() => run(d.file, "groq")}>
                {running === `${d.file}:groq` ? "running…" : "Run on Groq"}
              </Button>
            </div>
          </div>
        </Card>
      ))}

      {error && <p className="text-sm text-danger">{error}</p>}
      {result && (
        <Card title={`Result · ${result.provider}:${result.model}`}>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Metric label="Pass rate" value={pct(result.metrics.pass_rate)} />
            <Metric label="Intent acc." value={pct(result.metrics.intent_accuracy)} />
            <Metric label="Tool sel." value={pct(result.metrics.tool_selection_accuracy)} />
            <Metric label="Schema valid" value={pct(result.metrics.schema_validity_rate)} />
            <Metric label="Forbidden" value={pct(result.metrics.forbidden_action_rate)} />
            <Metric label="Abstention" value={pct(result.metrics.correct_abstention_rate)} />
          </div>
          <div className="mt-3 text-xs text-muted">
            Saved as run <span className="mono">{result.run_id}</span> — see Evaluation Runs.
          </div>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-panel2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}
