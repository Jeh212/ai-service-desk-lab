"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Card, Empty, JsonBlock, PageHeader } from "@/components/ui";

export default function RequestsPage() {
  const convs = useAsync(() => api.conversations(), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useAsync(
    () => (openId ? api.conversation(openId) : Promise.resolve(null)),
    [openId],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Request history" subtitle="Your past conversations with the assistant." />
      {convs.loading && <p className="text-sm text-muted">Loading…</p>}
      {convs.data && convs.data.length === 0 && <Empty>No conversations yet. Start in Chat.</Empty>}
      {convs.data?.map((c: any) => (
        <Card key={c.conversation_id}>
          <button
            onClick={() => setOpenId(openId === c.conversation_id ? null : c.conversation_id)}
            className="flex w-full items-center justify-between text-left"
          >
            <div>
              <div className="text-sm">{c.preview || "(empty)"}</div>
              <div className="mono text-xs text-muted">{c.conversation_id}</div>
            </div>
            <div className="text-xs text-muted">
              {c.message_count} msgs · {new Date(c.updated_at).toLocaleString()}
            </div>
          </button>
          {openId === c.conversation_id && detail.data && (
            <div className="mt-3 space-y-2">
              {detail.data.messages.map((m: any, i: number) => (
                <div key={i} className="text-sm">
                  <span className="mono text-xs text-muted">{m.role}:</span> {m.content}
                </div>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
