/**
 * Polices fournies avec l'app (fichiers dans assets/fonts pour le rendu, paquets @fontsource pour
 * l'aperçu dans le navigateur). Toutes sous licence libre (SIL OFL 1.1, Apache 2.0 pour Luckiest Guy).
 */
export type BuiltInFont = {
  family: string;
  /** Usage conseillé : titres ou texte (sous-titres). */
  role: "title" | "body";
  /** Police à graisse unique déjà épaisse : on ne la met pas en gras (sinon gras artificiel baveux). */
  singleWeight: boolean;
  label: string;
};

export const BUILT_IN_FONTS: BuiltInFont[] = [
  { family: "Bricolage Grotesque", role: "title", singleWeight: false, label: "Moderne et chaleureuse" },
  { family: "Anton", role: "title", singleWeight: true, label: "Condensée, très percutante" },
  { family: "Bebas Neue", role: "title", singleWeight: true, label: "Capitales hautes, style affiche" },
  { family: "Archivo Black", role: "title", singleWeight: true, label: "Large et massive" },
  { family: "DM Serif Display", role: "title", singleWeight: true, label: "Serif élégante" },
  { family: "Abril Fatface", role: "title", singleWeight: true, label: "Serif mode, très contrastée" },
  { family: "Luckiest Guy", role: "title", singleWeight: true, label: "Ronde et fun, façon BD" },
  { family: "Poppins", role: "body", singleWeight: false, label: "Géométrique, très lisible" },
  { family: "IBM Plex Sans", role: "body", singleWeight: false, label: "Sobre et pro" },
];

export const BUILT_IN_FAMILIES = BUILT_IN_FONTS.map((f) => f.family);

export const isBuiltInFont = (family: string) => BUILT_IN_FAMILIES.includes(family);

/** Faut-il demander du gras à libass pour cette police ? */
export const boldFor = (family: string) => !BUILT_IN_FONTS.find((f) => f.family === family)?.singleWeight;
