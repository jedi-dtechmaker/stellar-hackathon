import { PrismaClient } from "@prisma/client";
import pg from "pg";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "./config.js";

export const db = new PrismaClient();
const lockConnectionUrl = new URL(env.DATABASE_URL);
const serverCertificatePath = lockConnectionUrl.searchParams.get("sslcert");
if (serverCertificatePath) {
  lockConnectionUrl.searchParams.delete("sslcert");
  lockConnectionUrl.searchParams.set("sslrootcert", serverCertificatePath);
  lockConnectionUrl.searchParams.set("sslmode", "verify-full");
}
export const lockPool = new pg.Pool({ connectionString: lockConnectionUrl.toString(), max: 12 });
const lockSession = new AsyncLocalStorage<pg.PoolClient>();

// A scheduled invocation should skip a batch already running in another function.
export async function tryWithLock(key: string, run: () => Promise<void>): Promise<boolean> {
  const id = createHash("sha256").update(key).digest().readBigInt64BE().toString();
  const client = await lockPool.connect();
  let acquired = false;
  try {
    const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [id]);
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) return false;
    await lockSession.run(client, run);
    return true;
  } finally {
    try { if (acquired) await client.query("SELECT pg_advisory_unlock($1::bigint)", [id]); }
    finally { client.release(); }
  }
}

// Session advisory locks coordinate all API instances without keeping a Prisma
// transaction open during external requests. They release when the process dies.
export async function withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const id = createHash("sha256").update(key).digest().readBigInt64BE().toString();
  const inherited = lockSession.getStore();
  // Reuse a session for nested locks. Allocating another pooled connection for
  // each nested lock can deadlock the pool under concurrent bot traffic.
  if (inherited) {
    await inherited.query("SELECT pg_advisory_lock($1::bigint)", [id]);
    try { return await run(); }
    finally { await inherited.query("SELECT pg_advisory_unlock($1::bigint)", [id]); }
  }
  const client = await lockPool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [id]);
    return await lockSession.run(client, run);
  } finally {
    try { await client.query("SELECT pg_advisory_unlock($1::bigint)", [id]); }
    finally { client.release(); }
  }
}
