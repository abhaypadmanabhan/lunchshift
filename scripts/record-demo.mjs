// node scripts/record-demo.mjs [out.mp4] - drive /demo step by step in headless Chrome (1440x900) while recording a
// CDP screencast, then encode with ffmpeg. The backup video for the story: landing -> chat setup -> save to memory ->
// plan (live shopping) -> review and hold -> order -> next Sunday -> payoff. No audio.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "docs/proof/backup-story.mp4";
const base = process.env.DEMO_URL ?? "http://127.0.0.1:3000/demo";
const W = 1440, H = 900, PORT = 9334;
// Seconds to stay on each step before pressing "Next step" (the last value is the tail).
const HOLD = [6, 16, 9, 24, 16, 9, 26, 10];

const frames = join(".data", "frames-story");
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${W},${H}`, `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(".data", "chrome-rec2")}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { /* not up yet */ }
  await sleep(250);
}
if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener("open", r, { once: true })); // may already be open
let id = 0;
const pending = new Map();
// Every CDP call resolves within 5 s even if the page hangs, so the recording always finishes.
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    const t = setTimeout(() => { pending.delete(i); res({ timeout: true }); }, 5000);
    pending.set(i, (v) => { clearTimeout(t); res(v); });
    try { ws.send(JSON.stringify({ id: i, method, params })); } catch { clearTimeout(t); res({ error: true }); }
  });
const shots = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === "Page.screencastFrame") {
    shots.push({ t: msg.params.metadata.timestamp, data: msg.params.data });
    send("Page.screencastFrameAck", { sessionId: msg.params.sessionId });
  }
});
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: base });
await sleep(3000);
await send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
const t0 = Date.now();
const keepAlive = setInterval(() => void send("Runtime.evaluate", { expression: "void 0" }), 800);
const hardStop = setTimeout(() => { console.log("[record] hard stop"); }, (HOLD.reduce((a, b) => a + b, 0) + 30) * 1000);
for (let step = 0; step < HOLD.length; step++) {
  await sleep(HOLD[step] * 1000);
  if (step === HOLD.length - 1) break;
  const r = await send("Runtime.evaluate", {
    expression: `(() => { const b = [...document.querySelectorAll('button')].find(x => /Next step/.test(x.textContent || '')); if (b && !b.disabled) { b.click(); return 'clicked'; } return 'no button'; })()`,
    returnByValue: true,
  });
  console.log(`[record] t=${((Date.now() - t0) / 1000).toFixed(0)}s step ${step + 2}: ${r?.result?.value}`);
}
clearInterval(keepAlive);
clearTimeout(hardStop);
await send("Page.stopScreencast");
chrome.kill("SIGTERM");
const secs = (Date.now() - t0) / 1000;
const fps = 10;
const start = shots[0]?.t ?? 0;
let n = 0, j = 0;
for (let t = start; t < start + secs; t += 1 / fps) {
  while (j + 1 < shots.length && shots[j + 1].t <= t) j++;
  writeFileSync(join(frames, `f${String(n++).padStart(5, "0")}.jpg`), Buffer.from(shots[j].data, "base64"));
}
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(frames, "f%05d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=1440:900", out]);
console.log(`[record] ${shots.length} frames, ${secs.toFixed(0)} s -> ${out}`);
process.exit(0);
