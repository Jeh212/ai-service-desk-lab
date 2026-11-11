"use client";

import { ReactNode } from "react";

export function Card({
  title,
  children,
  right,
  className = "",
}: {
  title?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-panel ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-muted">{title}</h3>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-panel2 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const STATE_COLORS: Record<string, string> = {
  answered: "bg-accent/15 text-accent",
  action_completed: "bg-accent2/15 text-accent2",
  awaiting_confirmation: "bg-warn/15 text-warn",
  needs_clarification: "bg-warn/15 text-warn",
  human_review: "bg-accent/15 text-accent",
  error: "bg-danger/15 text-danger",
  ok: "bg-accent2/15 text-accent2",
  pending: "bg-warn/15 text-warn",
  approved: "bg-accent2/15 text-accent2",
  rejected: "bg-danger/15 text-danger",
};

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const cls = (tone && STATE_COLORS[tone]) ?? "bg-border text-muted";
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="mono max-h-[480px] overflow-auto rounded-lg border border-border bg-panel2 p-3 text-xs leading-relaxed text-[#b9c7de]">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">{children}</div>;
}

export function Button({
  children,
  onClick,
  disabled,
  tone = "accent",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "accent" | "ghost" | "danger";
  type?: "button" | "submit";
}) {
  const tones: Record<string, string> = {
    accent: "bg-accent text-white hover:brightness-110",
    ghost: "border border-border bg-panel2 text-muted hover:text-white",
    danger: "bg-danger text-white hover:brightness-110",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
    </div>
  );
}
