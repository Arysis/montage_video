import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublishForm } from "@/components/PublishForm";
import { requireUser } from "@/lib/auth/session";
import { planLimits } from "@/lib/billing/plans";
import { db, schema } from "@/lib/db";
import { formatDateTime, ownedProject } from "@/lib/projects";
import { type ConnectedAccount, publisher } from "@/lib/publish";
import { checkPlatforms, PLATFORM_LABELS } from "@/lib/qc/rules";
import { blocksPublication, pendingWarnings } from "@/lib/qc/types";
import { parisInputValues } from "@/lib/time";

export const metadata: Metadata = { title: "Publication" };

const STATUS: Record<string, string> = {
  scheduled: "Programmée",
  publishing: "En cours d'envoi",
  published: "Publiée",
  failed: "Échec",
};

export default async function PublicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erreur?: string; envoye?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const p = await ownedProject(user.id, id);
  if (!p.renderKey || !p.qcReport) redirect(`/app/projets/${p.id}/montage`);
  const qcOpen =
    blocksPublication(p.qcReport) || pendingWarnings(p.qcReport, p.acknowledgedWarnings).length > 0;

  let accounts: ConnectedAccount[] = [];
  let accountsError =
    sp.erreur === "liaison" ? "La liaison des comptes n'a pas pu démarrer. Réessaie." : undefined;
  if (user.publishProfileKey) {
    try {
      accounts = await publisher().connectedAccounts(user.publishProfileKey);
    } catch (err) {
      console.error("[publish] comptes", err);
      accountsError = "Impossible de lire tes comptes reliés pour le moment.";
    }
  }
  const history = await db()
    .select()
    .from(schema.publications)
    .where(eq(schema.publications.projectId, p.id))
    .orderBy(desc(schema.publications.createdAt))
    .limit(10);
  const platformChecks = checkPlatforms(["tiktok", "instagram", "youtube"], {
    durationSec: p.renderDurationSec ?? 0,
    sizeBytes: p.renderSizeBytes ?? 0,
    format: p.format,
  });
  const soon = parisInputValues(new Date(Date.now() + 2 * 3600_000));

  return (
    <PublishForm
      projectId={p.id}
      projectName={p.name}
      chosen={p.platforms}
      accounts={accounts}
      accountsError={accountsError}
      platformIssues={Object.fromEntries(
        platformChecks
          .filter((c) => c.status === "fail")
          .map((c) => [c.key.split(":")[1] ?? "", c.detail ?? c.title]),
      )}
      caption={p.caption ?? ""}
      hashtags={p.hashtags ?? ""}
      canSchedule={planLimits(user.plan).scheduling}
      defaultDate={soon.date}
      defaultTime={soon.time.slice(0, 3) + "00"}
      qcOpen={qcOpen}
      poster={`/api/files/${p.renderKey}.jpg`}
      video={`/api/files/${p.renderKey}`}
      format={p.format}
      sent={sp.envoye === "1"}
      history={history.map((h) => ({
        id: h.id,
        when: formatDateTime(h.scheduledAt),
        platforms: h.platforms.map((x) => PLATFORM_LABELS[x as keyof typeof PLATFORM_LABELS] ?? x).join(", "),
        status: STATUS[h.status] ?? h.status,
        failed: h.status === "failed",
        error: h.error,
      }))}
    />
  );
}
