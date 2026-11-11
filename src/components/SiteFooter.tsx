import Link from "next/link";
import { appName } from "@/lib/brand";
import styles from "./site.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span className="caption subtle">
          © {new Date().getFullYear()} {appName()}
        </span>
        <nav aria-label="Liens légaux" className={styles.footerNav}>
          <Link href="/mentions-legales">Mentions légales</Link>
          <Link href="/confidentialite">Confidentialité</Link>
          <Link href="/cgv">CGV</Link>
        </nav>
      </div>
    </footer>
  );
}
