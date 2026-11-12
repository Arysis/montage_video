"use client";

import { FolderSimple, House, List, Palette, Plus, X } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import styles from "./app.module.css";
import { LogoMark } from "./Logo";

type Props = {
  appName: string;
  firstName: string;
  initials: string;
  planLabel: string;
  lastProject: { id: string; name: string } | null;
};

const MAIN = [
  { href: "/app", label: "Accueil", icon: House, exact: true },
  { href: "/app/bibliotheque", label: "Bibliothèque", icon: FolderSimple },
  { href: "/app/brand-kit", label: "Brand Kit", icon: Palette },
];

const STEPS = [
  { key: "idee", n: 1, label: "Idée et fichiers" },
  { key: "prompteur", n: 2, label: "Prompteur" },
  { key: "montage", n: 3, label: "Montage" },
  { key: "publication", n: 4, label: "Publication" },
];

export function AppSidebar({ appName, firstName, initials, planLabel, lastProject }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const match = pathname.match(/^\/app\/projets\/([0-9a-f-]{36})\/(\w+)/);
  const projectId = match?.[1] ?? lastProject?.id;
  const activeStep = match?.[2] ?? (pathname === "/app/nouvelle-video" ? "idee" : null);
  const projectName = match
    ? lastProject && lastProject.id === match[1]
      ? lastProject.name
      : "Projet ouvert"
    : lastProject?.name;

  return (
    <>
      <div className={styles.mobileBar}>
        <Link href="/app" className={styles.brand}>
          <LogoMark />
          <span>{appName}</span>
        </Link>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="app-sidebar"
        >
          {open ? <X size={20} aria-hidden="true" /> : <List size={20} aria-hidden="true" />}
          Menu
        </button>
      </div>
      <aside
        id="app-sidebar"
        className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}
        onClick={() => setOpen(false)}
      >
        <Link href="/app" className={`${styles.brand} ${styles.desktopOnly}`}>
          <LogoMark />
          <span>{appName}</span>
        </Link>
        <Link href="/app/nouvelle-video" className="btn btn-secondary btn-block">
          <Plus size={20} aria-hidden="true" />
          Nouvelle vidéo
        </Link>
        <nav aria-label="Navigation de l'app" className={styles.navGroup}>
          {MAIN.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={styles.navItem}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={20} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        {(projectId || activeStep === "idee") && (
          <div className={styles.navGroup}>
            <span className={`caption subtle ${styles.groupLabel}`}>
              Projet en cours : {projectName ?? "nouveau"}
            </span>
            <nav aria-label="Étapes du projet" className={styles.navGroup}>
              {STEPS.map((s) => {
                const href =
                  s.key === "idee" && !match
                    ? "/app/nouvelle-video"
                    : projectId
                      ? `/app/projets/${projectId}/${s.key}`
                      : "/app/nouvelle-video";
                const active = activeStep === s.key;
                return (
                  <Link
                    key={s.key}
                    href={href}
                    className={styles.navItem}
                    aria-current={active ? "step" : undefined}
                  >
                    <span className={styles.stepNum} data-active={active || undefined}>
                      {s.n}
                    </span>
                    {s.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
        <div className={styles.account}>
          <span className={styles.avatar} aria-hidden="true">
            {initials}
          </span>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <Link href="/app/compte" style={{ fontWeight: 500 }}>
              {firstName}
            </Link>
            <Link href="/app/compte" className="caption muted">
              Offre {planLabel} · Changer d&apos;offre
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}
