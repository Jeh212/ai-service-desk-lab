"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Badge, Button, Card, Empty, PageHeader } from "@/components/ui";

export default function ReviewsPage() {
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const { data, loading, error, reload } = useAsync(
    () => api.reviews(filter === "pending" ? "pending" : undefined),
    [filter],
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const forbidden = error && (error.includes("staff") || error.includes("allowed"));

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    try {
      await api.decideReview(id, approve, notes[id] ?? "");
      reload();
    } catch (e) {
      /* surfaced via reload/error */
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Human Review"
        subtitle="Escalated cases (refunds, exceptions). Staff only — sign in as dave-acme."
      />

      <div className="flex gap-2">
        <Button tone={filter === "pending" ? "accent" : "ghost"} onClick={() => setFilter("pending")}>
          Pending
        </Button>
        <Button tone={filter === "all" ? "accent" : "ghost"} onClick={() => setFilter("all")}>
          All
        </Button>
      </div>

      {loading && <p className="text-sm text-muted">Loading…</p>}
      {forbidden && (
        <Empty>You need a staff role. Switch user to <span className="mono">dave-acme</span>.</Empty>
      )}
      {!forbidden && error && <p className="text-sm text-danger">{error}</p>}
      {data && data.reviews.length === 0 && <Empty>No reviews in this view.</Empty>}

      {data?.reviews.map((r: any) => (
        <Card key={r.review_id} right={<Badge tone={r.status}>{r.status}</Badge>}>
          <div className="text-sm">
            <span className="mono text-xs text-muted">{r.reason}</span> — {r.summary}
          </div>
          <div className="mt-1 text-xs text-muted">
            user {r.user_id} · {new Date(r.created_at).toLocaleString()}
          </div>
          {r.status === "pending" && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                placeholder="Decision note (optional)"
                value={notes[r.review_id] ?? ""}
                onChange={(e) => setNotes({ ...notes, [r.review_id]: e.target.value })}
                className="flex-1 rounded-lg border border-border bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <div className="flex gap-2">
                <Button onClick={() => decide(r.review_id, true)} disabled={busy === r.review_id}>
                  Approve
                </Button>
                <Button tone="danger" onClick={() => decide(r.review_id, false)} disabled={busy === r.review_id}>
                  Reject
                </Button>
              </div>
            </div>
          )}
          {r.decision_note && (
            <div className="mt-2 text-xs text-muted">
              Decided by {r.decided_by}: {r.decision_note || "(no note)"}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
