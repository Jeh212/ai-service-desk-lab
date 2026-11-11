"use client";

import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Badge, Card, PageHeader } from "@/components/ui";

export default function KnowledgePage() {
  const { data, loading } = useAsync(() => api.knowledge(), []);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Knowledge Base"
        subtitle="Tenant-scoped articles. Deterministic retrieval today; semantic later."
      />
      {loading && <p className="text-sm text-muted">Loading…</p>}
      {data?.documents.map((d: any) => (
        <Card key={d.doc_id} title={d.title} right={<Badge>{d.category}</Badge>}>
          <p className="text-sm text-[#c7d2e5]">{d.content}</p>
          <div className="mt-2 text-xs text-muted">
            v{d.version} · {d.published ? "published" : "draft"} · {d.org_id}
          </div>
        </Card>
      ))}
    </div>
  );
}
