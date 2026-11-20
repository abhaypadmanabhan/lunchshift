// npm run stack: sandbox grocer (:4100), background worker, and the built UI (:3000) as one process group.
// Ctrl-C (or SIGTERM) stops all three. Run `npm run build` first after UI changes.
import { spawn } from "node:child_process";

const procs = [
  ["grocer", ["run", "-s", "grocer"]],
  ["worker", ["run", "-s", "worker"]],
  ["ui", ["exec", "--", "next", "start", "-p", process.env.PORT ?? "3000"]],
].map(([name, args], i) => {
  const delay = i === 1 ? 1500 : 0; // worker waits for the grocer
  const p = { name, child: null };
  setTimeout(() => {
    // The demo serves real Open Food Facts products unless LUNCHSHIFT_CATALOG says otherwise.
    p.child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], env: { LUNCHSHIFT_CATALOG: "off", ...process.env } });
    const tag = (d) =>
      String(d)
        .split("\n")
        .filter((l) => l && !/ExperimentalWarning|trace-warnings/.test(l))
        .forEach((l) => console.log(`[${name}] ${l}`));
    p.child.stdout.on("data", tag);
    p.child.stderr.on("data", tag);
    p.child.on("exit", (code) => console.log(`[${name}] exited ${code}`));
  }, delay);
  return p;
});

const stop = () => {
  for (const p of procs) p.child?.kill("SIGTERM");
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
