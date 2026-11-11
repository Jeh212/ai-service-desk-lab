"use client";

import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Badge, Card, PageHeader } from "@/components/ui";

export default function IntentsPage() {
  const { data, loading, error } = useAsync(() => api.intents(), []);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Intent Explorer"
        subtitle={data ? `Taxonomy version ${data.version}` : "Versioned intent taxonomy"}
      />
      {loading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {data?.intents.map((it: any) => (
        <Card key={it.intent}>
          <div className="flex items-center justify-between">
            <span className="mono text-sm text-accent">{it.intent}</span>
            <div className="flex gap-1">
              {it.allowed_tools.length === 0 ? (
                <Badge>no tools</Badge>
              ) : (
                it.allowed_tools.map((t: string) => <Badge key={t}>{t}</Badge>)
              )}
            </div>
          </div>
          <p className="mt-2 text-sm text-[#c7d2e5]">{it.description}</p>
        </Card>
      ))}
    </div>
  );
}
