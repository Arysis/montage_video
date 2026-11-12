"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start", maxWidth: 480 }}
      >
        <h1 className="h2">Quelque chose a coincé</h1>
        <p className="muted">Une erreur est survenue de notre côté. Réessaie dans un instant.</p>
        <button type="button" className="btn btn-secondary" onClick={reset}>
          Réessayer
        </button>
      </div>
    </main>
  );
}
