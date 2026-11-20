// npm run demo:fullauto - the unattended proof: clean state, the usual bread already sold out at the store,
// and the Sunday schedule due 20 s after start. After launch nobody touches anything: no shopper, no operator.
// Effective autonomy still comes from Statsig and the parent's mandate (set auto_swap_and_hold beforehand).
import { spawn } from "node:child_process";

const at = new Date(Date.now() + 20_000).toISOString();
console.log(`[fullauto] schedule due at ${at}; no further inputs after this line`);
const child = spawn("node", ["scripts/stack.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    WORKER_SCHEDULE_AT: at,
    GROCER_PRESET_STOCKOUT: "demo", // the active catalog's usual bread
    GROCER_RESET_ON_START: "1",
    WORKER_RESET_ON_START: "1",
  },
});
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (c) => process.exit(c ?? 0));
