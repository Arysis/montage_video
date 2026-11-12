import { Play } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { DemoVideo } from "@/components/DemoVideo";
import styles from "@/components/home.module.css";
import { creatorPrice, offerFacts } from "@/lib/pricing";

const STEPS = [
  {
    n: "01",
    title: "Écris ton idée",
    text: "Décris ta vidéo en quelques phrases. Choisis le format et la plateforme.",
    capture: "nouvelle-video",
    alt: "Écran Nouvelle vidéo : champ de l'idée, choix du format et des plateformes",
  },
  {
    n: "02",
    title: "Ajoute tes fichiers",
    text: "Importe ton logo, tes images et ta musique. Ton Brand Kit s'applique ensuite partout.",
    capture: "bibliotheque",
    alt: "Écran Bibliothèque : logos, vidéos, images et musiques importés",
  },
  {
    n: "03",
    title: "Lis ton texte au prompteur",
    text: "Le texte défile à ton rythme. Tu enregistres ta voix ou ta vidéo.",
    capture: "prompteur",
    alt: "Écran Prompteur : texte qui défile et bouton d'enregistrement",
  },
  {
    n: "04",
    title: "Vérifie et publie",
    text: "L'IA vérifie le montage et les sous-titres. Tu refais une partie si besoin.",
    capture: "montage",
    alt: "Écran Montage : aperçu de la vidéo et liste du contrôle qualité",
  },
];

export default function HomePage() {
  const facts = offerFacts();
  const demo = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL;
  const captures = process.env.NEXT_PUBLIC_SHOW_CAPTURES === "1";
  return (
    <>
      <section className={`${styles.container} ${styles.hero} appear`}>
        <h1 className="display">Donne ton idée et tes fichiers. Récupère une vidéo prête à publier.</h1>
        <p className={styles.lead}>
          L&apos;IA écrit le script, monte la vidéo et ajoute les sous-titres, avec ta voix et ta marque.
        </p>
        <div className={styles.actions}>
          <Link href="/inscription" className="btn btn-primary btn-site">
            Créer ma première vidéo
          </Link>
          <a href="#demo" className="btn btn-secondary btn-site">
            <Play size={20} aria-hidden="true" />
            Voir la démo (30 s)
          </a>
        </div>
        <p className="caption subtle">Gratuit pour commencer. Sans carte bancaire.</p>
      </section>

      <section id="demo" className={styles.container} style={{ paddingBottom: 96, scrollMarginTop: 24 }}>
        <DemoVideo src={demo} poster={process.env.NEXT_PUBLIC_DEMO_POSTER_URL} />
      </section>

      <section id="comment-ca-marche" className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <h2 className="h2">Comment ça marche</h2>
            <p className="muted">Quatre étapes. Tu gardes la main sur chacune.</p>
          </div>
          <ol className={styles.steps} style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {STEPS.map((s) => (
              <li key={s.n} className={styles.step}>
                <div className={styles.capture}>
                  {captures ? (
                    <img src={`/captures/${s.capture}.webp`} alt={s.alt} loading="lazy" />
                  ) : (
                    <span className="caption subtle">[Capture : {s.title}]</span>
                  )}
                </div>
                <span className="caption subtle tabular">{s.n}</span>
                <h3 className="h3" style={{ fontSize: 18 }}>
                  {s.title}
                </h3>
                <p className="ui muted" style={{ fontWeight: 400 }}>
                  {s.text}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.container}>
          <div className={styles.sectionHead}>
            <h2 className="h2">Tarifs</h2>
            <p className="muted">
              Commence gratuitement. Passe à l&apos;offre Créateur quand tu publies plus.
            </p>
          </div>
          <div className={styles.plans}>
            <div className={`card ${styles.plan}`}>
              <h3 className="h3">Gratuit</h3>
              <p className={styles.price}>0 €</p>
              <p className="ui muted" style={{ fontWeight: 400 }}>
                Pour tester sur tes premières vidéos. {facts.freeVideos} vidéos par mois.
              </p>
            </div>
            <div className={`card ${styles.plan}`}>
              <h3 className="h3">Créateur</h3>
              <p className={styles.price}>
                {creatorPrice()} € <span className="ui muted">/ mois</span>
              </p>
              <p className="ui muted" style={{ fontWeight: 400 }}>
                Pour publier chaque semaine. Brand Kit et publication programmée inclus.
              </p>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 32 }}>
            <Link href="/tarifs" className="btn btn-secondary btn-site">
              Comparer les offres
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.cta}>
        <div
          className={styles.container}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}
        >
          <h2 className="h2" style={{ maxWidth: "14em" }}>
            Ta prochaine vidéo commence par une idée.
          </h2>
          <p className="muted">Crée ton compte et génère une première vidéo sans payer.</p>
          <Link href="/inscription" className="btn btn-primary btn-site">
            Créer ma première vidéo
          </Link>
        </div>
      </section>
    </>
  );
}
