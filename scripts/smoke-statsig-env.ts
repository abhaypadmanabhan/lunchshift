// npm run smoke:statsig-env - which environment tier and user does the autonomy_mode rule match? Prints modes and rule ids only.
const secret = process.env.STATSIG_SERVER_SECRET;

async function read(user: Record<string, unknown>) {
  const r = await fetch("https://api.statsig.com/v1/get_config", {
    method: "POST",
    headers: { "statsig-api-key": String(secret), "content-type": "application/json" },
    body: JSON.stringify({ configName: "autonomy_mode", user }),
    signal: AbortSignal.timeout(5000),
  });
  const b = (await r.json()) as { value?: { mode?: string }; rule_id?: string; group_name?: string };
  return `HTTP ${r.status} mode=${b.value?.mode ?? "-"} rule=${b.rule_id ?? "-"} group=${b.group_name ?? "-"}`;
}

async function main() {
  for (const tier of [undefined, "production", "development", "staging"]) {
    const user = { userID: "lunchshift-demo", ...(tier ? { statsigEnvironment: { tier } } : {}) };
    console.log(`tier=${tier ?? "(none)"}`.padEnd(20), await read(user));
  }
  console.log("customID ".padEnd(20), await read({ userID: "x", customIDs: { householdID: "lunchshift-demo" } }));
}
main();
