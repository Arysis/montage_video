import { CalendarBlank, Check, Plus } from "@phosphor-icons/react/dist/ssr";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/app.module.css";
import { TopBar } from "@/components/TopBar";
import { requireUser } from "@/lib/auth/session";
import { PLAN_LABELS } from "@/lib/billing/plans";
import { db, schema } from "@/lib/db";
import { PLATFORM_LABELS, type Platform } from "@/lib/qc/rules";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  PLATFORM_SHORT,
  projectStep,
  recentProjects,
  STATUS_LABELS,
  usage,
} from "@/lib/projects";

export const metadata: Metadata = { title: "Tes projets" };

export default async function AppHome() {
  const user = await requireUser();
  const projects = await recentProjects(user.id);
  const u = await usage(user);
  const upcoming = await db()
    .select({ pub: schema.publications, name: schema.projects.name })
    .from(schema.publications)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.publications.projectId))
    .where(
      and(
        eq(schema.publications.userId, user.id),
        inArray(schema.publications.status, ["scheduled", "publishing"]),
        gte(schema.publications.scheduledAt, new Date(Date.now() - 3600_000)),
      ),
    )
    .orderBy(asc(schema.publications.scheduledAt))
    .limit(3);

  return (
    <>
      <TopBar
        title="Tes projets"
        actions={
          <Link href="/app/nouvelle-video" className="btn btn-primary">
            <Plus size={20} aria-hidden="true" />
            Nouvelle vidéo
          </Link>
        }
      />
      <div className={styles.body}>
        <section className={`${styles.content} appear`} aria-label="Projets récents">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 16,
            }}
          >
            <h2 className="ui" style={{ fontWeight: 600 }}>
              Récents
            </h2>
            <span className="caption subtle">Trié par date de modification</span>
          </div>
          {projects.length === 0 ? (
            <div
              className="card"
              style={{
                padding: 32,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              <h3 className="h3">Ta première vidéo t&apos;attend</h3>
              <p className="muted measure">
                Écris ton idée, ajoute tes fichiers. L&apos;IA prépare le script, tu le lis au prompteur.
              </p>
              <Link href="/app/nouvelle-video" className="btn btn-primary">
                Créer ma première vidéo
              </Link>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 16,
              }}
            >
              {projects.map((p) => {
                const ready =
                  p.status === "ready" ||
                  p.status === "published" ||
                  p.status === "scheduled" ||
                  p.renderStatus === "done";
                const label =
                  p.renderStatus === "done" && p.status === "montage" ? "Prête" : STATUS_LABELS[p.status];
                return (
                  <Link
                    key={p.id}
                    href={`/app/projets/${p.id}/${projectStep(p)}`}
                    className="card"
                    style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8 }}
                  >
                    <div
                      style={{
                        aspectRatio: p.format.replace(":", " / "),
                        borderRadius: 6,
                        background: "var(--color-surface-raised)",
                        display: "flex",
                        alignItems: "flex-end",
                        padding: 8,
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      {p.renderKey && (
                        <img
                          src={`/api/files/${p.renderKey}.jpg`}
                          alt={`Première image de ${p.name}`}
                          style={{
                            position: "absolute",
                            inset: 0,
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                          loading="lazy"
                        />
                      )}
                      <span
                        className="caption tabular"
                        style={{ position: "relative", color: "var(--color-text-subtle)" }}
                      >
                        {formatDuration(p.renderDurationSec)}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 4px 4px" }}>
                      <span
                        style={{
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.name}
                      </span>
                      <span className="caption subtle">
                        {p.platforms.map((x) => PLATFORM_SHORT[x]).join(", ") || p.format} ·{" "}
                        {formatDate(p.updatedAt)}
                      </span>
                      <span className={`badge ${ready ? "badge-success" : ""}`}>
                        {ready && <Check size={12} aria-hidden="true" />}
                        {label}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <aside className={styles.panel} aria-label="Résumé" style={{ gap: 32 }}>
          <section className={styles.section}>
            <h2>À publier</h2>
            {upcoming.length ? (
              <ul
                style={{
                  margin: 0,
                  padding: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {upcoming.map(({ pub, name }) => (
                  <li
                    key={pub.id}
                    className="card"
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      padding: 12,
                      background: "transparent",
                    }}
                  >
                    <CalendarBlank
                      size={20}
                      aria-hidden="true"
                      style={{ flex: "none", color: "var(--color-text-muted)" }}
                    />
                    <div>
                      <div style={{ fontWeight: 500 }}>{name}</div>
                      <div className="caption subtle">
                        {pub.platforms.map((x) => PLATFORM_LABELS[x as Platform]).join(" et ")} ·{" "}
                        {formatDateTime(pub.scheduledAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Aucune publication prévue.</p>
            )}
          </section>
          <section className={styles.section}>
            <h2>Ton Brand Kit</h2>
            <p className="muted">
              Ton logo, tes couleurs et tes polices s&apos;appliquent à chaque nouvelle vidéo.
            </p>
            <Link href="/app/brand-kit" className="btn btn-secondary" style={{ alignSelf: "flex-start" }}>
              Modifier mon Brand Kit
            </Link>
          </section>
          <section className={styles.section}>
            <h2>Ton offre</h2>
            <div style={{ display: "flex", justifyContent: "space-between" }} className="tabular">
              <span>{PLAN_LABELS[user.plan]}</span>
              <span className="muted">
                {u.used} / {u.limit} vidéos ce mois
              </span>
            </div>
            <div
              className="progress"
              role="progressbar"
              aria-label="Vidéos utilisées ce mois"
              aria-valuemin={0}
              aria-valuemax={u.limit}
              aria-valuenow={u.used}
            >
              <span style={{ width: `${Math.min(100, (u.used / u.limit) * 100)}%` }} />
            </div>
            <Link href="/tarifs" className="muted">
              Comparer les offres
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
