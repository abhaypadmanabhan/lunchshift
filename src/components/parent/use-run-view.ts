"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunView } from "@/lib/domain/view";

export const POLL_MS = 2000;
/** While the agent is shopping, poll every second so the cart and the agent panel fill in live. */
export const LIVE_POLL_MS = 1000;

const isLive = (v: RunView | null) => v?.run?.status === "running" || v?.run?.status === "scheduled";

/**
 * Polls GET /api/state: every 2 s, every 1 s while a run is in progress.
 * `/?state=a…h` passes through to the static samples; `setSample` moves between them (the /demo bar on samples).
 */
export function useRunView() {
  const [view, setView] = useState<RunView | null>(null);
  const [failingSince, setFailingSince] = useState<string | null>(null);
  const [sample, setSampleState] = useState<string | null>(null);
  const qs = useRef("");
  const latest = useRef<RunView | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/state${qs.current}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as RunView;
      latest.current = next;
      setView(next);
      setFailingSince(null);
    } catch {
      setFailingSince((prev) => prev ?? new Date().toISOString());
    }
  }, []);

  const setSample = useCallback(
    (s: string) => {
      qs.current = `?state=${encodeURIComponent(s)}`;
      setSampleState(s);
      void refresh();
    },
    [refresh],
  );

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("state");
    qs.current = s ? `?state=${encodeURIComponent(s)}` : "";
    setSampleState(s);
    let stopped = false;
    let t: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await refresh();
      if (!stopped) t = setTimeout(() => void loop(), isLive(latest.current) ? LIVE_POLL_MS : POLL_MS);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [refresh]);

  return { view, failingSince, refresh, sample, setSample };
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** POST to a parent endpoint. Never throws: a missing route, a refusal or a dropped connection comes back as a message. */
export async function postParent<T = { ok: boolean }>(path: string, body?: unknown): Promise<ActionResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "Couldn't reach LunchShift. Check your connection and try again." };
  }
  if (res.status === 404 || res.status === 501) {
    return { ok: false, message: "This isn't switched on yet. Nothing was changed." };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // a non-JSON reply is handled by the status check below
  }
  const reason =
    data && typeof data === "object" && "reason" in data && typeof (data as { reason: unknown }).reason === "string"
      ? (data as { reason: string }).reason
      : null;
  const okFlag = data && typeof data === "object" && "ok" in data ? (data as { ok: unknown }).ok !== false : true;
  if (!res.ok || !okFlag) {
    return { ok: false, message: reason ?? `That didn't go through (error ${res.status}). Try again in a moment.` };
  }
  return { ok: true, data: data as T };
}
