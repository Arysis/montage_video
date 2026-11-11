import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { appName } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: appName(), template: `%s · ${appName()}` },
  description: "Donne ton idée et tes fichiers. Récupère une vidéo prête à publier.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#0E0F11", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
