import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { Logo } from "./Logo";
import styles from "./site.module.css";

export async function SiteHeader() {
  const user = await currentUser();
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Logo size={28} fontSize={20} />
        <nav aria-label="Navigation principale" className={styles.nav}>
          <Link href="/#comment-ca-marche" className={styles.navLink}>
            Comment ça marche
          </Link>
          <Link href="/tarifs" className={styles.navLink}>
            Tarifs
          </Link>
          {user ? (
            <Link href="/app" className="btn btn-secondary">
              Ouvrir l&apos;app
            </Link>
          ) : (
            <>
              <Link href="/connexion" className={styles.navLink}>
                Se connecter
              </Link>
              <Link href="/inscription" className="btn btn-secondary">
                Créer un compte
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
