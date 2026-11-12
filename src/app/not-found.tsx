import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start", maxWidth: 480 }}
      >
        <p className="caption subtle">Erreur 404</p>
        <h1 className="h1">Cette page n&apos;existe pas</h1>
        <p className="muted">Le lien est peut-être ancien, ou la vidéo a été supprimée.</p>
        <Link href="/" className="btn btn-secondary">
          Retour à l&apos;accueil
        </Link>
      </div>
    </main>
  );
}
