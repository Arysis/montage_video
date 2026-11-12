import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return ["", "/tarifs", "/inscription", "/connexion", "/mentions-legales", "/confidentialite", "/cgv"].map(
    (p) => ({
      url: `${base}${p}`,
    }),
  );
}
