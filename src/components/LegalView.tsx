import Link from "next/link";
import { LEGAL_PAGES, type LegalPage } from "@/lib/legal";
import styles from "./legal.module.css";

export function LegalView({ page }: { page: LegalPage }) {
  return (
    <div className={styles.wrap}>
      <nav aria-label="Pages légales" className={styles.nav}>
        {LEGAL_PAGES.map((p) => (
          <Link
            key={p.slug}
            href={`/${p.slug}`}
            className={styles.navItem}
            aria-current={p.slug === page.slug ? "page" : undefined}
          >
            {p.title}
          </Link>
        ))}
      </nav>
      <article className={styles.article}>
        <h1 className="h1">{page.title}</h1>
        <p className="caption subtle" style={{ marginTop: 12 }}>
          Dernière mise à jour : {page.updatedAt}
        </p>
        {page.sections.map((s) => (
          <section key={s.title} className={styles.section}>
            <h2 className="h3">{s.title}</h2>
            {s.paragraphs.map((p, i) => (
              <p key={i} className="muted measure">
                {p}
              </p>
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}
