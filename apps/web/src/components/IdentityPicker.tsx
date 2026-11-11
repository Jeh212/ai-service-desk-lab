"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { setSession } from "@/lib/session";
import { Button } from "./ui";

const DEMO_USERS = [
  { code: "alice-acme", label: "Alice — Acme customer (active PRO)" },
  { code: "bob-acme", label: "Bob — Acme customer (cancelled)" },
  { code: "carol-globex", label: "Carol — Globex customer" },
  { code: "dave-acme", label: "Dave — Acme support agent (staff)" },
];

export function IdentityPicker({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function login(code: string) {
    setBusy(code);
    setError(null);
    try {
      const { token, user } = await api.login(code);
      setSession(token, user);
    } catch (e: any) {
      setError(e?.message ?? "Login failed. Is the API running and seeded?");
    } finally {
      setBusy(null);
    }
  }

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        {DEMO_USERS.map((u) => (
          <Button key={u.code} tone="ghost" onClick={() => login(u.code)} disabled={!!busy}>
            {u.code}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-24 max-w-lg px-4">
      <h1 className="text-2xl font-semibold">AI Service Desk Lab</h1>
      <p className="mt-2 text-sm text-muted">
        Pick a demo identity to sign in. The backend issues a signed session token —
        the browser never asserts its own org/user id.
      </p>
      <div className="mt-6 space-y-2">
        {DEMO_USERS.map((u) => (
          <button
            key={u.code}
            onClick={() => login(u.code)}
            disabled={!!busy}
            className="flex w-full items-center justify-between rounded-lg border border-border bg-panel px-4 py-3 text-left hover:border-accent disabled:opacity-50"
          >
            <span>{u.label}</span>
            <span className="mono text-xs text-muted">{busy === u.code ? "…" : u.code}</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      <p className="mt-6 text-xs text-muted">
        Demo auth is for local study only (see docs/learning/Lab01). Run{" "}
        <span className="mono">make seed</span> if login fails.
      </p>
    </div>
  );
}
