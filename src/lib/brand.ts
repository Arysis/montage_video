/** Nom de l'app, à définir (variable APP_NAME). */
export function appName(): string {
  return process.env.APP_NAME || "[Nom de l'app]";
}
