"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunView } from "@/lib/domain/view";

export const POLL_MS = 2000;

/** Polls GET /api/state every 2 s. `/?state=a|b|c|d` passes through to the static samples. */
export function useRunView() {
  const [view, setView] = useState<RunView | null>(null);
  const [failingSince, setFailingSince] = useState<string | null>(null);
  const qs = useRef("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/state${qs.current}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setView((await res.json()) as RunView);
      setFailingSince(null);
    } catch {
      setFailingSince((prev) => prev ?? new Date().toISOString());
    }
  }, []);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("state");
    qs.current = s ? `?state=${encodeURIComponent(s)}` : "";
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { view, failingSince, refresh };
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
