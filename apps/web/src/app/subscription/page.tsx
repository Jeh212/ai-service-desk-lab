"use client";

import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { Badge, Card, PageHeader, JsonBlock } from "@/components/ui";

export default function SubscriptionPage() {
  const sub = useAsync(() => api.subscription(), []);
  const billing = useAsync(() => api.billing(), []);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="My subscription" subtitle="Read-only, scoped to your account." />

      {sub.loading && <p className="text-sm text-muted">Loading…</p>}
      {sub.error && <p className="text-sm text-danger">{sub.error}</p>}
      {sub.data && (
        <Card title="Subscription">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Plan" value={`${sub.data.plan?.name ?? sub.data.subscription.plan_code}`} />
            <Field
              label="Status"
              value={<Badge tone={sub.data.subscription.status}>{sub.data.subscription.status}</Badge>}
            />
            <Field
              label="Price"
              value={sub.data.plan ? `$${(sub.data.plan.price_cents / 100).toFixed(2)}/mo` : "—"}
            />
            <Field
              label="Renews / ends"
              value={new Date(sub.data.subscription.current_period_end).toLocaleDateString()}
            />
          </div>
        </Card>
      )}

      <Card title="Billing history">
        {billing.loading && <p className="text-sm text-muted">Loading…</p>}
        {billing.data && billing.data.charges.length === 0 && (
          <p className="text-sm text-muted">No charges on file.</p>
        )}
        {billing.data && billing.data.charges.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1">Date</th>
                <th>Description</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {billing.data.charges.map((c: any) => (
                <tr key={c.charge_id} className="border-t border-border">
                  <td className="py-1.5">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td>{c.description}</td>
                  <td>
                    <Badge tone={c.status === "paid" ? "ok" : undefined}>{c.status}</Badge>
                  </td>
                  <td className="text-right">${(c.amount_cents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
