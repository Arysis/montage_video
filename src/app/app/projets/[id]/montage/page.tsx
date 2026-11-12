import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MontageView } from "@/components/MontageView";
import { requireUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { buildCues } from "@/lib/plan/subtitles";
import { PLATFORM_SHORT, ownedProject } from "@/lib/projects";

export const metadata: Metadata = { title: "Montage" };

export default async function MontagePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const p = await ownedProject(user.id, id);
  if (!p.script) redirect(`/app/projets/${p.id}/idee`);
  if (!p.selectedTakeId) redirect(`/app/projets/${p.id}/prompteur`);
  const plan = p.editPlan;
  const [take] = await db()
    .select({ number: schema.takes.number })
    .from(schema.takes)
    .where(eq(schema.takes.id, p.selectedTakeId));
  let musicName: string | null = null;
  if (plan?.music) {
    const [m] = await db()
      .select({ name: schema.assets.name })
      .from(schema.assets)
      .where(eq(schema.assets.id, plan.music.assetId));
    musicName = m?.name ?? null;
  }
  const sceneOrder = p.script.scenes.map((s) => s.id);
  const formatName = p.platforms.length === 1 ? PLATFORM_SHORT[p.platforms[0]!] : null;
  return (
    <MontageView
      projectId={p.id}
      projectName={p.name}
      title={`Montage · ${formatName ? `${formatName} ` : ""}${p.format}`}
      status={{
        renderStatus: p.renderStatus,
        renderProgress: p.renderProgress,
        renderMessage: p.renderMessage,
      }}
      video={
        p.renderKey
          ? {
              src: `/api/files/${p.renderKey}`,
              poster: `/api/files/${p.renderKey}.jpg`,
              download: `/api/files/${p.renderKey}?telecharger=1`,
            }
          : null
      }
      format={p.format}
      timeline={
        plan
          ? {
              duration: plan.durationSec,
              scenes: plan.scenes.map((s) => {
                const base = s.id.split(".")[0]!;
                const n = sceneOrder.indexOf(base) + 1;
                return {
                  id: s.id,
                  label: `${n || "?"}${s.id.includes(".") ? `.${s.id.split(".")[1]}` : ""}`,
                  text: s.overlayText ?? s.spokenText.split(" ").slice(0, 4).join(" "),
                  start: s.start,
                  end: s.end,
                };
              }),
              cues: buildCues(plan).map((c) => ({
                start: c.start,
                end: c.end,
                text: c.words.map((w) => w.word).join(" "),
              })),
              voiceLabel: take ? `Prise prompteur n° ${take.number}` : "Voix",
              music: plan.music ? (musicName ?? "Musique") : null,
            }
          : null
      }
      report={p.qcReport}
      acknowledged={p.acknowledgedWarnings}
    />
  );
}
