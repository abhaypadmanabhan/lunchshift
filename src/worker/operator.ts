// Demo operator actions (fixture and gate controls). Never counted as shopper clicks; each is audited as actor "operator".
import { DEMO_STOCKOUT_SKU } from "../lib/domain/fixture";
import { DEMO_RUN_ID, DEMO_WEEK, ensureSeeded, grocerOperator } from "./deps";

export type OperatorAction = "reset" | "stockout" | "drop" | "run";

export async function operatorAction(action: OperatorAction): Promise<{ ok: true; detail: string }> {
  const store = await ensureSeeded();
  const op = grocerOperator();
  const note = async (summary: string) => {
    if (await store.getRun(DEMO_RUN_ID)) {
      await store.appendEvent({ runId: DEMO_RUN_ID, actor: "operator", type: "note", summary: `Demo operator: ${summary}`, data: { action } });
    }
  };
  switch (action) {
    case "reset":
      await store.reset();
      await op.reset();
      return { ok: true, detail: "Store and app state reset to the clean fixture" };
    case "stockout":
      await op.setStock(DEMO_STOCKOUT_SKU, 0);
      await note("usual bread set to 0 stock at the sandbox store");
      return { ok: true, detail: "Usual bread sold out at the store; the worker sees the stockout event on its next tick" };
    case "drop":
      await op.dropNextHoldResponse(true);
      await note("store will commit the next hold and drop its response");
      return { ok: true, detail: "Next hold response will be dropped after commit" };
    case "run": {
      const now = new Date().toISOString();
      if (!(await store.getRun(DEMO_RUN_ID))) {
        await store.upsertRun({
          id: DEMO_RUN_ID,
          householdId: "lunchshift-demo",
          weekOf: DEMO_WEEK,
          trigger: "schedule",
          status: "scheduled",
          observedMode: "suggest_only",
          effectiveMode: "suggest_only",
          basketVersion: 0,
          createdAt: now,
          updatedAt: now,
        });
      }
      return { ok: true, detail: "Sunday run marked due; the worker picks it up on its next tick" };
    }
  }
}

if (process.argv[1]?.endsWith("operator.ts")) {
  const a = process.argv[2] as OperatorAction;
  operatorAction(a).then(
    (r) => {
      console.log(r.detail);
      process.exit(0);
    },
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    },
  );
}
