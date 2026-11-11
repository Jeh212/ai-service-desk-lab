"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Card, JsonBlock, PageHeader } from "@/components/ui";

export default function ContractsPage() {
  const { data, loading } = useAsync(() => api.contracts(), []);
  const [selected, setSelected] = useState(0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contracts Explorer"
        subtitle="Real Pydantic JSON Schemas with valid / invalid examples."
      />
      {loading && <p className="text-sm text-muted">Loading…</p>}
      {data && (
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div className="space-y-1">
            {data.contracts.map((c: any, i: number) => (
              <button
                key={c.name}
                onClick={() => setSelected(i)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                  selected === i ? "bg-accent/15 text-accent" : "bg-panel2 text-[#c7d2e5]"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <Card title="JSON Schema">
              <JsonBlock data={data.contracts[selected].schema} />
            </Card>
            {data.contracts[selected].examples && (
              <div className="grid gap-3 md:grid-cols-2">
                <Card title="Valid example">
                  <JsonBlock data={data.contracts[selected].examples.valid} />
                </Card>
                <Card title="Invalid example">
                  <JsonBlock data={data.contracts[selected].examples.invalid} />
                  <p className="mt-2 text-xs text-danger">
                    {data.contracts[selected].examples.invalid_reason}
                  </p>
                </Card>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
