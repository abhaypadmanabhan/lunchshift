// getStore(): SingleStore when configured and answering SELECT 1 within 5 s, else SQLite.
import type { AppStore } from "../domain/types";
import { isSingleStoreConfigured, SingleStoreStore } from "./singlestore";
import { SqliteStore } from "./sqlite";

export interface StoreStatus {
  provider: AppStore["provider"];
  detail: string; // safe for the UI chip: never a host, user or connection string
}

interface Resolved { store: AppStore; status: StoreStatus }
const g = globalThis as { __lunchshiftStore?: Promise<Resolved> };

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/** Error class only (never a host, user or value): DNS, auth, TLS, network, timeout. */
export function errorClass(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return `DNS: host does not resolve (${code})`;
  if (/ACCESS_DENIED|ER_DBACCESS|ER_BAD_DB/.test(code)) return `auth/database (${code})`;
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return `TLS (${code})`;
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT/.test(code)) return `network (${code})`;
  if (e instanceof Error && e.message === "timeout") return "timeout";
  return code || "error";
}
const reason = errorClass;

async function resolve(): Promise<Resolved> {
  let fallbackWhy = "SingleStore not configured";
  if (isSingleStoreConfigured()) {
    const ss = new SingleStoreStore();
    try {
      await withTimeout(ss.ping(), 15000); // first connect may CREATE DATABASE
      await withTimeout(ss.init(), 15000);
      console.log("[store] provider=singlestore");
      return { store: ss, status: { provider: "singlestore", detail: `SingleStore Helios, TLS verified (${ss.tlsTrust})` } };
    } catch (e) {
      fallbackWhy = `SingleStore unavailable (${reason(e)})`;
      void ss.close().catch(() => undefined);
    }
  }
  const sq = new SqliteStore();
  await sq.init();
  console.log("[store] provider=sqlite");
  return { store: sq, status: { provider: "sqlite", detail: `SQLite fallback: ${fallbackWhy}` } };
}

const resolved = () => (g.__lunchshiftStore ??= resolve());

export async function getStore(): Promise<AppStore> {
  return (await resolved()).store;
}

export async function storeStatus(): Promise<StoreStatus> {
  return (await resolved()).status;
}

export { SingleStoreStore } from "./singlestore";
