// node scripts/record.mjs <url> <seconds> <out.mp4> - record a page in headless Chrome via the CDP screencast
// (1440x900), then encode with ffmpeg. Used for the backup demo video. No audio.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const [url = "http://127.0.0.1:3000/?onboarding=0", secs = "60", out = "docs/proof/backup-demo.mp4"] = process.argv.slice(2);
const W = 1440, H = 900, PORT = 9333;
const frames = join(".data", "frames");
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${W},${H}`, `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(".data", "chrome-rec")}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === "page");
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
  } catch { /* not up yet */ }
  await sleep(250);
}
if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener("open", r, { once: true })); // may already be open
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
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
await send("Page.navigate", { url });
await sleep(1500);
await send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
console.log(`[record] ${secs}s of ${url}`);
// Keep the page producing frames even when nothing animates.
const end = Date.now() + Number(secs) * 1000;
while (Date.now() < end) { await sleep(1000); await send("Runtime.evaluate", { expression: "void 0" }); }
await send("Page.stopScreencast");
chrome.kill("SIGTERM");

// Re-time frames to a constant 10 fps by holding each frame until the next one arrives.
const fps = 10;
const t0 = shots[0]?.t ?? 0;
const t1 = t0 + Number(secs);
let n = 0, j = 0;
for (let t = t0; t < t1; t += 1 / fps) {
  while (j + 1 < shots.length && shots[j + 1].t <= t) j++;
  writeFileSync(join(frames, `f${String(n++).padStart(5, "0")}.jpg`), Buffer.from(shots[j].data, "base64"));
}
mkdirSync(out.split("/").slice(0, -1).join("/") || ".", { recursive: true });
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(frames, "f%05d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=1440:900", out]);
console.log(`[record] ${shots.length} frames -> ${n} at ${fps} fps -> ${out}`);
process.exit(0);
