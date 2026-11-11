"use client";

import { useState } from "react";
import { api, AssistantResponse } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Badge, Button, Card, PageHeader } from "@/components/ui";

export default function PlaygroundPage() {
  const prompts = useAsync(() => api.prompts(), []);
  const [message, setMessage] = useState("How does cancellation work?");
  const [sysA, setSysA] = useState("system-v2");
  const [sysB, setSysB] = useState("system-v1");
  const [a, setA] = useState<AssistantResponse | null>(null);
  const [b, setB] = useState<AssistantResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const [ra, rb] = await Promise.all([
        api.playground({ message, system_version: sysA }),
        api.playground({ message, system_version: sysB }),
      ]);
      setA(ra);
      setB(rb);
    } catch (e: any) {
      setError(e?.message ?? "Run failed");
    } finally {
      setBusy(false);
    }
  }

  const versions: string[] = prompts.data ? Object.keys(prompts.data.system) : ["system-v2"];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Prompt / Groq Playground"
        subtitle="Compare two system-prompt versions on the same input and the same provider."
      />

      <Card>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-border bg-panel2 p-3 text-sm outline-none focus:border-accent"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <VersionPick label="Prompt A" value={sysA} options={versions} onChange={setSysA} />
          <VersionPick label="Prompt B" value={sysB} options={versions} onChange={setSysB} />
          <Button onClick={run} disabled={busy}>
            {busy ? "Running…" : "Run both"}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <ResultColumn title={`A · ${sysA}`} resp={a} prompt={prompts.data?.system?.[sysA]} />
        <ResultColumn title={`B · ${sysB}`} resp={b} prompt={prompts.data?.system?.[sysB]} />
      </div>
    </div>
  );
}

function VersionPick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-panel2 px-2 py-1.5 text-sm text-white"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResultColumn({
  title,
  resp,
  prompt,
}: {
  title: string;
  resp: AssistantResponse | null;
  prompt?: string;
}) {
  return (
    <Card title={title}>
      {prompt && (
        <details className="mb-3">
          <summary className="cursor-pointer text-xs text-muted">system prompt</summary>
          <pre className="mono mt-2 whitespace-pre-wrap rounded-lg border border-border bg-panel2 p-2 text-xs text-[#b9c7de]">
            {prompt}
          </pre>
        </details>
      )}
      {!resp && <p className="text-sm text-muted">Run to see the result.</p>}
      {resp && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone={resp.state}>{resp.state}</Badge>
            {resp.intent && <Badge>intent: {resp.intent.intent}</Badge>}
            {resp.intent && <Badge>conf: {resp.intent.confidence.toFixed(2)}</Badge>}
          </div>
          <p className="text-sm text-[#c7d2e5]">{resp.message}</p>
          <div className="rounded-lg border border-border bg-panel2 p-2">
            {resp.trace.map((s, i) => (
              <div key={i} className="flex items-center justify-between py-0.5 text-xs">
                <span className="mono">{s.step}</span>
                <span className="flex items-center gap-2 text-muted">
                  <Badge tone={s.status}>{s.status}</Badge>
                  {s.duration_ms.toFixed(1)}ms
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
