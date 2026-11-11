import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Limite le nombre de tentatives par clé (ex. « login:ip:1.2.3.4 ») sur une fenêtre de temps.
 * Stocké dans Postgres pour fonctionner avec plusieurs instances.
 */
export async function rateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  const result = await db().execute<{ count: number }>(sql`
    insert into rate_limits (key, count, reset_at)
    values (${key}, 1, now() + make_interval(secs => ${windowSec}))
    on conflict (key) do update set
      count = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
      reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => ${windowSec}) else rate_limits.reset_at end
    returning count
  `);
  return Number(result.rows[0]?.count ?? 0) <= max;
}
