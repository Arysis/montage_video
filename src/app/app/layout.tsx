import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { AppSidebar } from "@/components/AppSidebar";
import styles from "@/components/app.module.css";
import { requireUser } from "@/lib/auth/session";
import { PLAN_LABELS } from "@/lib/billing/plans";
import { appName } from "@/lib/brand";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { robots: { index: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [last] = await db()
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.userId, user.id))
    .orderBy(desc(schema.projects.updatedAt))
    .limit(1);
  const name = user.firstName || user.email.split("@")[0]!;
  return (
    <div className={styles.shell}>
      <AppSidebar
        appName={appName()}
        firstName={name}
        initials={name.slice(0, 1).toUpperCase()}
        planLabel={PLAN_LABELS[user.plan]}
        lastProject={last ?? null}
      />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
