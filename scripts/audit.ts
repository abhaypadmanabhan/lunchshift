// npm run audit -- <runId>: replay the full decision for a run from the app store (ordered audit events).
import { getStore, storeStatus } from "../src/lib/store";
import { DEMO_RUN_ID } from "../src/worker/deps";

async function main() {
  const runId = process.argv[2] ?? DEMO_RUN_ID;
  const store = await getStore();
  const run = await store.getRun(runId);
  console.log(`store: ${(await storeStatus()).detail}`);
  if (!run) {
    console.log(`no run ${runId}`);
    process.exit(1);
  }
  console.log(`run ${run.id} status=${run.status} observed=${run.observedMode} effective=${run.effectiveMode} key=${run.operationKey ?? "-"}`);
  for (const e of await store.listEvents(runId)) console.log(`${String(e.seq).padStart(3)} ${e.at.slice(11, 19)} ${e.actor.padEnd(8)} ${e.type.padEnd(20)} ${e.summary}`);
  const r = await store.getReceipt(runId);
  if (r) console.log(`receipt: ${r.hold.holdId} matched=${r.matched} active=${r.activeHoldsForRun} total=$${(r.hold.totalCents / 100).toFixed(2)}`);
  const k = await store.getKpis(runId);
  if (k) console.log(`kpis: ${JSON.stringify(k)}`);
  process.exit(0);
}
main();
