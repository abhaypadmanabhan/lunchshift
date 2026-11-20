// npm run diag:singlestore - where does the SingleStore connection fail? Prints stages, timings and error classes only.
import dns from "node:dns/promises";
import net from "node:net";
import mysql from "mysql2/promise";
import { readConn } from "../src/lib/store/singlestore";
import { errorClass } from "../src/lib/store";

async function main() {
  const c = readConn(process.env);
  console.log(`config: port ${c.port}, database ${c.database ? "set" : "none (will create lunchshift)"}, user ${c.user ? "set" : "missing"}`);
  let t = Date.now();
  try {
    const a = await dns.lookup(c.host);
    console.log(`dns: ok (IPv${a.family}) ${Date.now() - t} ms`);
  } catch (e) {
    return console.log(`dns: FAIL ${errorClass(e)}`);
  }
  t = Date.now();
  const tcp = await new Promise<string>((res) => {
    const s = net.connect({ host: c.host, port: c.port });
    s.setTimeout(8000);
    s.on("connect", () => (s.destroy(), res(`ok ${Date.now() - t} ms`)));
    s.on("timeout", () => (s.destroy(), res("FAIL timeout 8 s (port blocked, IP allowlist, or workspace paused)")));
    s.on("error", (e) => res(`FAIL ${errorClass(e)}`));
  });
  console.log(`tcp ${c.port}: ${tcp}`);
  if (!tcp.startsWith("ok")) return;
  t = Date.now();
  try {
    const conn = await mysql.createConnection({ ...c, database: undefined, ssl: { rejectUnauthorized: true }, connectTimeout: 20000 });
    const [rows] = await conn.query("SELECT 1 AS one");
    console.log(`sql: ok ${Date.now() - t} ms`, JSON.stringify(rows));
    await conn.end();
  } catch (e) {
    console.log(`sql: FAIL ${errorClass(e)} after ${Date.now() - t} ms`);
  }
}
main();
