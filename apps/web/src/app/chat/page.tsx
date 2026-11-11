"use client";

import { useRef, useState } from "react";
import { api, AssistantResponse } from "@/lib/api";
import { Badge, Button, PageHeader } from "@/components/ui";

interface Turn {
  role: "user" | "assistant";
  content: string;
  resp?: AssistantResponse;
}

const SUGGESTIONS = [
  "How does cancellation work?",
  "I want to cancel my subscription now",
  "What plan am I on?",
  "Why was I charged?",
  "I'd like a refund",
];

export default function ChatPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  function scroll() {
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setError(null);
    setTurns((t) => [...t, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    try {
      const resp = await api.sendMessage(text, conversationId);
      setConversationId(resp.conversation_id);
      setTurns((t) => [...t, { role: "assistant", content: resp.message, resp }]);
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
      scroll();
    }
  }

  async function confirm(resp: AssistantResponse, yes: boolean) {
    if (!resp.proposal) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api.confirm(resp.conversation_id, resp.proposal.proposal_id, yes);
      setTurns((t) => [...t, { role: "assistant", content: out.message, resp: out }]);
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
      scroll();
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Chat"
        subtitle="Talk to the AI assistant. Sensitive actions require your explicit confirmation."
      />

      <div className="flex min-h-[420px] flex-col gap-3">
        {turns.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
            <p className="mb-3">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} tone="ghost" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "self-end" : "self-start"}>
            <div
              className={`max-w-xl whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                turn.role === "user"
                  ? "bg-accent text-white"
                  : "border border-border bg-panel"
              }`}
            >
              {turn.content}
            </div>
            {turn.resp && <AssistantExtras resp={turn.resp} onConfirm={confirm} busy={busy} />}
          </div>
        ))}
        {busy && <div className="self-start text-sm text-muted">assistant is thinking…</div>}
        <div ref={endRef} />
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 rounded-lg border border-border bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <Button type="submit" disabled={busy}>
          Send
        </Button>
      </form>
    </div>
  );
}

function AssistantExtras({
  resp,
  onConfirm,
  busy,
}: {
  resp: AssistantResponse;
  onConfirm: (r: AssistantResponse, yes: boolean) => void;
  busy: boolean;
}) {
  const [showTrace, setShowTrace] = useState(false);
  return (
    <div className="mt-2 max-w-xl space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={resp.state}>{resp.state}</Badge>
        {resp.intent && <Badge>intent: {resp.intent.intent}</Badge>}
        {resp.error_code && <Badge tone="error">{resp.error_code}</Badge>}
        <button
          onClick={() => setShowTrace((s) => !s)}
          className="text-muted underline hover:text-white"
        >
          {showTrace ? "hide" : "show"} trace ({resp.trace.length})
        </button>
      </div>

      {resp.state === "awaiting_confirmation" && resp.proposal && (
        <div className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
          <div className="font-medium text-warn">Confirm cancellation</div>
          <p className="mt-1 text-[#d6deeb]">{resp.proposal.terms.summary}</p>
          <ul className="mt-2 space-y-0.5 text-xs text-muted">
            <li>Effective: {new Date(resp.proposal.terms.effective_date).toLocaleDateString()}</li>
            <li>
              Refund: {(resp.proposal.terms.refund_amount_cents / 100).toFixed(2)}{" "}
              {resp.proposal.terms.currency}
            </li>
            <li>Fee: {(resp.proposal.terms.penalty_cents / 100).toFixed(2)}</li>
            <li>Expires: {new Date(resp.proposal.expires_at).toLocaleTimeString()}</li>
          </ul>
          <div className="mt-3 flex gap-2">
            <Button tone="danger" onClick={() => onConfirm(resp, true)} disabled={busy}>
              Confirm cancellation
            </Button>
            <Button tone="ghost" onClick={() => onConfirm(resp, false)} disabled={busy}>
              Keep subscription
            </Button>
          </div>
        </div>
      )}

      {resp.state === "human_review" && (
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-xs text-[#d6deeb]">
          Routed to a human specialist. Reference:{" "}
          <span className="mono">{resp.review_id}</span>
        </div>
      )}

      {showTrace && (
        <div className="rounded-lg border border-border bg-panel2 p-2">
          {resp.trace.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-0.5 text-xs">
              <span className="mono">{s.step}</span>
              <span className="flex items-center gap-2">
                {s.detail && <span className="text-muted">{s.detail}</span>}
                <Badge tone={s.status}>{s.status}</Badge>
                <span className="text-muted">{s.duration_ms.toFixed(1)}ms</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
