import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __pool?: pg.Pool; __db?: Db };

export function pool(): pg.Pool {
  if (!globalForDb.__pool) {
    globalForDb.__pool = new pg.Pool({ connectionString: env().DATABASE_URL, max: 10 });
  }
  return globalForDb.__pool;
}

export function db(): Db {
  if (!globalForDb.__db) globalForDb.__db = drizzle(pool(), { schema });
  return globalForDb.__db;
}

export async function closeDb() {
  await globalForDb.__pool?.end();
  globalForDb.__pool = undefined;
  globalForDb.__db = undefined;
}

export { schema };
