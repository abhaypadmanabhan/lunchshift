"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { cn } from "cn";
import { ArrowUp, Check, X } from "lucide-react";
import type { ProposedFact, RunView } from "@/lib/domain/view";
import { sampleChatReply, sampleConfirm, type ChatReply, type ConfirmReply } from "@/lib/view/sample-chat";
import { AppButton, Notice } from "./ui";
import { postParent, type ActionResult } from "./use-run-view";

export const SAMPLE_SETUP_MESSAGE = "Maya is 8, peanut allergy, hates mushrooms, $35 a week, pickup Sunday";

type Mode = "onboarding" | "assistant";
type Saved = ConfirmReply["saved"];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST /api/chat. On a static sample (`?state=`) a local keyword reader answers instead, so the flow can be shown offline. */
async function sendChat(message: string, mode: Mode, sample: boolean): Promise<ActionResult<ChatReply>> {
  if (sample) {
    await wait(650);
    return { ok: true, data: sampleChatReply(message, mode) };
  }
  return postParent<ChatReply>("/api/chat", { message, mode });
}

async function confirmFacts(facts: ProposedFact[], sample: boolean): Promise<ActionResult<ConfirmReply>> {
  if (sample) {
    await wait(500);
    return { ok: true, data: sampleConfirm(facts) };
  }
  return postParent<ConfirmReply>("/api/chat/confirm", { facts });
}

const memoryName = (m: Saved[number]["memory"]) => (m === "cognee" ? "Cognee" : "local memory (Cognee offline)");

/** One chip per fact the agent heard. Tap to confirm or un-confirm; the cross drops it. */
export function FactChips({
  facts,
  on,
  onToggle,
  onRemove,
}: {
  facts: ProposedFact[];
  on: Set<string>;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <ul className="ls-stagger flex flex-wrap gap-2" aria-label="What LunchShift heard">
      {facts.map((f) => {
        const kept = on.has(f.id);
        return (
          <li
            key={f.id}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border pl-1 transition-colors duration-[var(--dur-fast)]",
              kept ? "border-primary/40 bg-ok-soft" : "border-input/30 bg-card",
            )}
          >
            <button
              type="button"
              aria-pressed={kept}
              onClick={() => onToggle(f.id)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full pr-1 pl-2 text-left text-base leading-snug"
            >
              <span
                className={cn("flex size-5 items-center justify-center rounded-full", kept ? "bg-primary text-primary-foreground" : "border border-input/60")}
                aria-hidden
              >
                {kept ? <Check className="size-3.5" strokeWidth={3} /> : null}
              </span>
              <span className={cn(!kept && "text-muted-foreground")}>{f.label}</span>
            </button>
            <button
              type="button"
              aria-label={`Remove ${f.label}`}
              onClick={() => onRemove(f.id)}
              className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "Saved to memory · Cognee", one row per fact, staggered so each save reads as its own step. */
export function SavedSteps({ saved }: { saved: Saved }) {
  return (
    <ol className="ls-stagger space-y-2" aria-label="Saved to memory">
      {saved.map((s) => (
        <li key={s.label} className="flex items-center gap-3 rounded-lg bg-card px-4 py-3 border">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden>
            <Check className="size-3.5" strokeWidth={3} />
          </span>
          <span className="min-w-0 flex-1 leading-snug">
            <span className="block text-base font-medium">{s.label}</span>
            <span className="block text-[0.9375rem] text-muted-foreground">
              Saved to memory · <span className="text-foreground">{memoryName(s.memory)}</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  placeholder,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && !busy) onSubmit();
  };
  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 rounded-lg border border-input/40 bg-card p-1.5 pl-4 focus-within:border-ring"
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) submit(e);
        }}
        placeholder={placeholder}
        className="field-sizing-content max-h-32 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-base leading-snug outline-none placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        disabled={!value.trim() || busy}
        aria-label="Send"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity duration-[var(--dur-fast)] disabled:opacity-35"
      >
        <ArrowUp className="size-5" strokeWidth={2.4} aria-hidden />
      </button>
    </form>
  );
}

function Typing() {
  return (
    <p className="ls-enter flex items-center gap-1.5 py-2 text-base text-muted-foreground" role="status">
      <span className="sr-only">LunchShift is reading…</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
          style={{ animationDelay: `${i * 160}ms` }}
          aria-hidden
        />
      ))}
    </p>
  );
}

type Turn = { from: "agent" | "parent"; text: string };

export type ChatCommand = { n: number; kind: "send" | "save" };

/**
 * Setup as a conversation: the agent greets, the parent writes naturally, the agent proposes facts as chips,
 * "Save to memory" stores them, then "Plan this week".
 */
export function ChatSetup({
  view,
  sample,
  command,
  onPlan,
  onUseForm,
  onRefresh,
}: {
  view: RunView;
  sample: boolean;
  command?: ChatCommand | null;
  onPlan: () => void;
  onUseForm: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [turns, setTurns] = useState<Turn[]>([
    {
      from: "agent",
      text: "Hi, I'm LunchShift. Tell me about your kid: name, age, allergies, anything they won't eat, your weekly budget and pickup day.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"send" | "save" | null>(null);
  const [facts, setFacts] = useState<ProposedFact[]>([]);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Saved | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const lastCommand = useRef(0);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length, facts.length, saved, busy]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg) return;
    setTurns((t) => [...t, { from: "parent", text: msg }]);
    setInput("");
    setErr(null);
    setBusy("send");
    const res = await sendChat(msg, "onboarding", sample);
    setBusy(null);
    if (!res.ok) {
      setErr(`${res.message} You can set up with the form instead.`);
      return;
    }
    setTurns((t) => [...t, { from: "agent", text: res.data.reply }]);
    // Facts from a later message add to (or replace) the ones already on screen.
    setFacts((prev) => [...prev.filter((p) => !res.data.facts.some((f) => f.id === p.id)), ...res.data.facts]);
    setOn((prev) => new Set([...prev, ...res.data.facts.map((f) => f.id)]));
  };

  const save = async () => {
    const chosen = facts.filter((f) => on.has(f.id));
    if (!chosen.length) return;
    setBusy("save");
    setErr(null);
    const res = await confirmFacts(chosen, sample);
    setBusy(null);
    if (!res.ok) {
      setErr(`${res.message} Nothing was saved; your answers are still here.`);
      return;
    }
    setSaved(res.data.saved);
    setTurns((t) => [
      ...t,
      {
        from: "agent",
        text: "Saved. I'll check every label against these, every week.",
      },
    ]);
    await onRefresh();
  };

  // The /demo bar drives the same two actions a parent would take.
  useEffect(() => {
    if (!command || command.n === lastCommand.current) return;
    lastCommand.current = command.n;
    if (command.kind === "send") {
      // Typed into the composer first so the viewer sees the words, then sent (no cleanup: React dev re-runs effects).
      setInput(SAMPLE_SETUP_MESSAGE);
      setTimeout(() => void send(SAMPLE_SETUP_MESSAGE), 900);
      return;
    }
    if (command.kind === "save" && facts.length && !saved) void save();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per demo command
  }, [command]);

  const chosen = facts.filter((f) => on.has(f.id)).length;

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col">
      <div className="flex items-center justify-between gap-4 px-1">
        <span className="text-[0.9375rem] text-muted-foreground">Say it your way. Nothing is saved until you confirm.</span>
        <button
          type="button"
          onClick={onUseForm}
          className="inline-flex min-h-11 shrink-0 items-center rounded-md px-1 text-[0.9375rem] font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
        >
          Use a form instead
        </button>
      </div>

      <div className="mt-4 flex-1 space-y-5 px-1" aria-live="polite">
        {turns.map((t, i) =>
          t.from === "agent" ? (
            <div key={i} className="ls-enter max-w-[48ch]">
              <p className="text-[0.9375rem] font-medium text-primary">LunchShift</p>
              <p className="mt-0.5 text-[1.0625rem] leading-relaxed">{t.text}</p>
            </div>
          ) : (
            <p key={i} className="ls-enter ml-auto w-fit max-w-[70%] rounded-xl bg-secondary px-4 py-3 text-base leading-normal">
              {t.text}
            </p>
          ),
        )}
        {busy === "send" ? <Typing /> : null}

        {facts.length && !saved ? (
          <section className="ls-enter space-y-4 rounded-lg border bg-card p-5" aria-label="Facts to confirm">
            <FactChips
              facts={facts}
              on={on}
              onToggle={(id) => setOn((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])))}
              onRemove={(id) => {
                setFacts((f) => f.filter((x) => x.id !== id));
                setOn((s) => new Set([...s].filter((x) => x !== id)));
              }}
            />
            <AppButton className="w-full" busy={busy === "save"} disabled={!chosen} onClick={() => void save()}>
              Save {chosen} to memory
            </AppButton>
          </section>
        ) : null}

        {saved ? <SavedSteps saved={saved} /> : null}
        {err ? <Notice tone="alert">{err}</Notice> : null}
        <div ref={end} />
      </div>

      <div className="sticky bottom-0 mt-6 bg-background pt-2 pb-4 ">
        {saved ? (
          <AppButton className="ls-enter min-h-12 w-full text-[1.0625rem]" onClick={onPlan}>
            Plan this week
          </AppButton>
        ) : (
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={() => void send(input)}
            busy={busy !== null}
            label={`Tell LunchShift about ${view.household.childName || "your child"}`}
            placeholder={SAMPLE_SETUP_MESSAGE}
            autoFocus
          />
        )}
      </div>
    </div>
  );
}

/** "Ask LunchShift…": a persistent composer on This week and Cart. Replies and fact chips open above it. */
/** `docked`: lives at the foot of the desktop right rail instead of floating above the bottom tabs. */
export function AskBar({
  sample,
  onRefresh,
  docked = false,
  className,
}: {
  sample: boolean;
  onRefresh: () => Promise<void>;
  docked?: boolean;
  className?: string;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"send" | "save" | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [reply, setReply] = useState<ChatReply | null>(null);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Saved | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const close = () => {
    setReply(null);
    setAsked(null);
    setSaved(null);
    setErr(null);
  };

  const send = async () => {
    const msg = input.trim();
    if (!msg) return;
    close();
    setAsked(msg);
    setInput("");
    setBusy("send");
    const res = await sendChat(msg, "assistant", sample);
    setBusy(null);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    setReply(res.data);
    setOn(new Set(res.data.facts.map((f) => f.id)));
  };

  const save = async () => {
    if (!reply) return;
    setBusy("save");
    const res = await confirmFacts(
      reply.facts.filter((f) => on.has(f.id)),
      sample,
    );
    setBusy(null);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    setSaved(res.data.saved);
    await onRefresh();
  };

  const open = asked !== null;
  return (
    <div
      className={cn(
        docked
          ? "flex min-h-0 flex-col gap-2"
          : "sticky bottom-[4.1rem] z-10 -mx-1 mt-8 space-y-2 bg-background px-1 pt-4 pb-3",
        className,
      )}
    >
      {open ? (
        <section
          className={cn(
            "ls-enter relative space-y-3 rounded-lg bg-card p-4 pr-12",
            docked
              ? "min-h-0 overflow-y-auto overscroll-contain border [scrollbar-width:thin]"
              : "border",
          )}
          aria-label="LunchShift's reply"
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute top-1.5 right-1.5 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
          <p className="text-[0.9375rem] text-muted-foreground">“{asked}”</p>
          {busy === "send" ? <Typing /> : null}
          {reply ? <p className="text-base leading-relaxed">{reply.reply}</p> : null}
          {reply?.facts.length && !saved ? (
            <>
              <FactChips
                facts={reply.facts}
                on={on}
                onToggle={(id) => setOn((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])))}
                onRemove={(id) => {
                  setReply((r) => (r ? { ...r, facts: r.facts.filter((f) => f.id !== id) } : r));
                  setOn((s) => new Set([...s].filter((x) => x !== id)));
                }}
              />
              <AppButton className="w-full" busy={busy === "save"} disabled={!on.size} onClick={() => void save()}>
                Confirm
              </AppButton>
            </>
          ) : null}
          {saved ? <SavedSteps saved={saved} /> : null}
          {err ? <Notice tone="alert">{err}</Notice> : null}
        </section>
      ) : null}
      {docked && !open ? (
        <p className="px-1 text-[0.9375rem] leading-snug text-muted-foreground">
          Tell it something new, like a food your child stopped eating. You confirm before it remembers.
        </p>
      ) : null}
      <Composer value={input} onChange={setInput} onSubmit={() => void send()} busy={busy !== null} label="Ask LunchShift" placeholder="Ask LunchShift…" />
    </div>
  );
}
