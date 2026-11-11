"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { clearSession, getUser, onSessionChange } from "@/lib/session";
import type { User } from "@/lib/api";
import { IdentityPicker } from "./IdentityPicker";

const NAV: { group: string; items: { href: string; label: string }[] }[] = [
  {
    group: "Customer Experience",
    items: [
      { href: "/chat", label: "Chat" },
      { href: "/subscription", label: "My subscription" },
      { href: "/requests", label: "Request history" },
    ],
  },
  {
    group: "AI Engineering Lab",
    items: [
      { href: "/lab", label: "Dashboard" },
      { href: "/lab/intents", label: "Intent Explorer" },
      { href: "/lab/contracts", label: "Contracts Explorer" },
      { href: "/lab/tools", label: "Tool Registry" },
      { href: "/lab/knowledge", label: "Knowledge Base" },
      { href: "/lab/datasets", label: "Evaluation Datasets" },
      { href: "/lab/evals", label: "Evaluation Runs" },
      { href: "/lab/traces", label: "Trace Viewer" },
      { href: "/lab/playground", label: "Prompt / Groq Playground" },
      { href: "/lab/reviews", label: "Human Review" },
      { href: "/lab/observability", label: "Observability" },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setUser(getUser());
    setReady(true);
    return onSessionChange(() => setUser(getUser()));
  }, []);

  if (!ready) return null;
  if (!user) return <IdentityPicker />;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-panel2 md:flex">
        <div className="border-b border-border px-4 py-4">
          <div className="text-sm font-semibold">AI Service Desk Lab</div>
          <div className="mt-0.5 text-xs text-muted">reliable LLM features</div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((section) => (
            <div key={section.group} className="mb-4">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                {section.group}
              </div>
              {section.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-lg px-2 py-1.5 text-sm ${
                      active ? "bg-accent/15 text-accent" : "text-[#c7d2e5] hover:bg-panel"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-panel px-4 py-3">
          <div className="text-sm text-muted md:hidden">AI Service Desk Lab</div>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted">
              {user.name} ·{" "}
              <span className="mono text-xs">{user.org_id}</span>
              {user.roles.includes("agent") && (
                <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">
                  staff
                </span>
              )}
            </span>
            <button
              onClick={() => clearSession()}
              className="rounded-lg border border-border px-2 py-1 text-xs text-muted hover:text-white"
            >
              Switch user
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
