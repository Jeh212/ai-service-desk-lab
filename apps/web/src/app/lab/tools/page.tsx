"use client";

import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Badge, Card, JsonBlock, PageHeader } from "@/components/ui";

export default function ToolsPage() {
  const { data, loading } = useAsync(() => api.tools(), []);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Tool Registry"
        subtitle="The exact tools exposed to the model — narrow, permissioned, validated."
      />
      {loading && <p className="text-sm text-muted">Loading…</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {data?.tools.map((t: any) => (
          <Card key={t.name} title={<span className="mono text-accent">{t.name}</span>}>
            <p className="text-sm text-[#c7d2e5]">{t.description}</p>
            <div className="mt-2 flex flex-wrap gap-1 text-xs">
              {t.allowed_roles.map((r: string) => (
                <Badge key={r}>{r}</Badge>
              ))}
              <Badge tone="ok">handler: {t.handler}</Badge>
            </div>
            {t.possible_errors.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1 text-xs">
                {t.possible_errors.map((e: string) => (
                  <Badge key={e} tone="error">
                    {e}
                  </Badge>
                ))}
              </div>
            )}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted">parameters (JSON Schema)</summary>
              <div className="mt-2">
                <JsonBlock data={t.parameters} />
              </div>
            </details>
          </Card>
        ))}
      </div>
    </div>
  );
}
