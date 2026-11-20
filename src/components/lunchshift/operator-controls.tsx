"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const ACTIONS = [
  { path: "/api/demo/run", label: "Run Sunday order now" },
  { path: "/api/demo/stockout", label: "Inject bread stockout" },
  { path: "/api/demo/drop", label: "Drop next store response" },
  { path: "/api/demo/reset", label: "Reset demo" },
] as const;

type Result = { label: string; ok: boolean; text: string };

/** Demo operator actions. Visually apart from the shopper's view and never counted as shopper clicks. */
export function OperatorControls({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function act(path: string, label: string) {
    setBusy(path);
    try {
      const res = await fetch(path, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      const ok = res.ok && body.ok !== false;
      setResult({
        label,
        ok,
        text: ok ? "Done" : `${body.reason === "not wired" ? "Not wired yet" : (body.reason ?? "Failed")} (HTTP ${res.status})`,
      });
      onDone();
    } catch {
      setResult({ label, ok: false, text: "Could not reach the server" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-dashed border-input/60 bg-sunken/70 p-5" aria-labelledby="operator-title">
      <h2 id="operator-title" className="text-base font-semibold">
        Demo operator
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Stage controls for the recording. Not shopper actions; they are not counted in shopper clicks.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {ACTIONS.map((a) => (
          <Button
            key={a.path}
            variant="outline"
            className="h-10 justify-start bg-card px-3 text-sm"
            disabled={busy !== null}
            onClick={() => act(a.path, a.label)}
          >
            {busy === a.path ? "Sending…" : a.label}
          </Button>
        ))}
      </div>
      <p className="mt-3 min-h-5 text-sm" aria-live="polite">
        {result ? (
          <>
            <span className="text-muted-foreground">{result.label}: </span>
            <span className={result.ok ? "font-medium text-ok" : "font-medium text-wait"}>{result.text}</span>
          </>
        ) : null}
      </p>
    </section>
  );
}
