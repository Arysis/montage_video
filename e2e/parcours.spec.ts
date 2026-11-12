import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * Parcours complet d'un créateur : inscription, idée, prompteur (micro simulé par Chromium),
 * montage réel avec FFmpeg, contrôle qualité, publication simulée, puis suppression du compte.
 */

const image = path.resolve(".data/e2e-fixtures/photo-produit.png");
const password = "un-mot-de-passe-solide";

async function signUp(page: Page, email: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/inscription");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  const consent = page.getByRole("checkbox");
  if (await consent.count()) await consent.first().check();
  await page.getByRole("button", { name: /Créer mon compte/ }).click();
  await page.waitForURL("**/app/nouvelle-video");
}

test("de l'idée à la publication", async ({ page }) => {
  await signUp(page, `e2e-video-${Date.now()}@example.com`);

  // Étape 1 : idée et fichiers
  await page
    .getByLabel("Écris ton idée")
    .fill("Trois erreurs à éviter quand on débute sur TikTok. Ton direct et un peu drôle.");
  await page.locator('input[type="file"]').setInputFiles(image);
  await expect(
    page.getByRole("list", { name: "Fichiers ajoutés" }).getByText("photo-produit.png"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Générer le script" }).click();
  await page.waitForURL(/\/script$/);

  // Étape 2 : script détaillé, relu puis validé
  await expect(page.getByRole("heading", { name: /Scène 1/ })).toBeVisible();
  await expect(page.getByLabel("Ce que tu dis").first()).not.toBeEmpty();
  await page.getByLabel("Texte à l'écran").first().fill("3 erreurs");
  await page.getByLabel("Vers la scène 2").selectOption("flash");
  await page.getByRole("button", { name: "Valider le script et enregistrer ma voix" }).click();
  await page.waitForURL(/\/prompteur$/);

  // Étape 3 : prompteur, enregistrement avec le micro simulé
  await page.getByLabel("Compte à rebours").selectOption("0");
  await page.getByRole("button", { name: "Lancer l'enregistrement" }).click();
  await page.waitForTimeout(12_000);
  await page.getByRole("button", { name: /Arrêter/ }).click();
  await expect(page.getByText("Prise 1")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Retenue")).toBeVisible();

  // Étape 4 : montage
  await page.getByRole("button", { name: "Passer au montage" }).click();
  await page.waitForURL(/\/montage$/);
  await expect(page.getByText(/L'IA a vérifié \d+ points/)).toBeVisible({ timeout: 200_000 });
  await expect(page.locator("video")).toBeVisible();

  // Les points orange se valident avec « Garder tel quel ».
  const keepButtons = page.getByRole("button", { name: "Garder tel quel" });
  for (let n = await keepButtons.count(); n > 0; n--) {
    await keepButtons.first().click();
    await expect(keepButtons).toHaveCount(n - 1);
  }
  await expect(page.getByText("La publication est bloquée")).toHaveCount(0);

  // Étape 5 : publication
  await page.getByRole("link", { name: "Passer à la publication" }).click();
  await page.waitForURL(/\/publication$/);
  // Premier passage : aucun compte relié, on relie (service simulé).
  await expect(page.getByText("Pas encore connecté").first()).toBeVisible();
  await page.getByRole("button", { name: "Connecter mon compte" }).first().click();
  await expect(page.getByText("Connecté : @compte_test").first()).toBeVisible();
  await page.getByRole("checkbox", { name: /TikTok/ }).check();
  await page.getByRole("button", { name: "Publier maintenant" }).click();
  await expect(page.getByText("C'est envoyé")).toBeVisible();
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByText("Publiée", { exact: true }).count();
      },
      { timeout: 60_000, intervals: [2000] },
    )
    .toBeGreaterThan(0);

  // Accueil : le projet apparaît
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Tes projets" })).toBeVisible();
});

test("bibliothèque, Brand Kit et compte", async ({ page }) => {
  const email = `e2e-compte-${Date.now()}@example.com`;
  await signUp(page, email);

  // Déconnexion puis reconnexion
  await page.goto("/app/compte");
  await page.getByRole("button", { name: "Me déconnecter" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto("/connexion");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Me connecter" }).click();
  await page.waitForURL((url) => url.pathname === "/app");

  await page.goto("/app/bibliotheque");
  await page.locator('input[type="file"]').setInputFiles(image);
  await expect(page.getByText("photo-produit.png").first()).toBeVisible();
  await page.getByLabel("Droits d'utilisation").selectOption("free");
  await expect(page.getByLabel("Droits d'utilisation")).toHaveValue("free");

  await page.goto("/app/brand-kit");
  await page.getByRole("button", { name: "Enregistrer mon Brand Kit" }).click();
  await expect(page.getByText("Brand Kit enregistré.")).toBeVisible();

  await page.goto("/app/compte");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Télécharger mes données" }).click();
  expect((await download).suggestedFilename()).toMatch(/^mes-donnees-.*\.json$/);

  await page.getByLabel("Écris SUPPRIMER pour confirmer").fill("SUPPRIMER");
  await page.getByLabel("Ton mot de passe").fill(password);
  await page.getByRole("button", { name: "Supprimer mon compte" }).click();
  await page.waitForURL((url) => url.pathname === "/");

  await page.goto("/connexion");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByText("E-mail ou mot de passe incorrect.")).toBeVisible();
});
