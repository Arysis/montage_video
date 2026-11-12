# [Nom de l'app] : montage vidéo par l'IA

Application web pour les créateurs solo (TikTok, Reels, YouTube Shorts). Tu écris une idée, l'IA écrit le script,
tu le lis au prompteur, l'IA monte la vidéo avec tes fichiers et ton Brand Kit, un contrôle qualité automatique
vérifie le résultat, puis tu publies ou tu programmes.

## Parcours

1. **Idée et fichiers** : idée, format (9:16, 1:1, 16:9), plateformes, durée, fichiers de la bibliothèque.
2. **Prompteur** : texte qui défile, réglages (vitesse, taille, compte à rebours, miroir), enregistrement au micro,
   plusieurs prises, prise retenue.
3. **Montage** : l'IA choisit les plans, le moteur calcule un plan de montage (JSON) calé mot à mot sur la voix,
   FFmpeg rend la vidéo. Le contrôle qualité s'affiche à côté de l'aperçu, avec « Refaire cette partie » et
   « Garder tel quel ».
4. **Publication** : comptes reliés, légende proposée par l'IA, hashtags, maintenant ou programmé (heure de Paris).

## Architecture

| Élément | Choix |
| --- | --- |
| Site et app | Next.js 15 (App Router, server actions), React 19, TypeScript strict |
| Base de données | PostgreSQL, Drizzle ORM, migrations dans `drizzle/` |
| Tâches longues | pg-boss (file dans Postgres) : analyse des fichiers, montage, publication |
| Worker | `src/worker/index.ts` : un process séparé qui fait le rendu FFmpeg |
| Fichiers | S3 compatible (Cloudflare R2, Scaleway, AWS) ou disque local en développement |
| IA | Anthropic (Claude) : script, choix des plans, relecture des images, légendes |
| Transcription | whisper.cpp en local (modèle small, inclus dans l'image Docker, gratuit et sans clé) ou Deepgram nova-3 (`STT_PROVIDER=deepgram`, plus rapide) ; horodatage mot à mot de ce qui est réellement dit, qui sert aux sous-titres |
| Voix | nettoyée avant le rendu (`src/lib/audio/voice.ts`) : coupe-bas, débruitage RNNoise puis FFT, égalisation, anti-sifflantes, compression, volume à -16 LUFS |
| Publication | Ayrshare (TikTok, Instagram, YouTube) |
| Paiement | Stripe Checkout, portail client, webhook signé |
| E-mails | Resend (mot de passe oublié) |

### Le montage

- L'IA ne manipule jamais la vidéo. Elle produit des **indications** (fichiers par scène, mouvement, texte à l'écran,
  musique, rythme), validées par un schéma.
- `src/lib/plan/build.ts` transforme ces indications et la transcription en **plan de montage** : chaque coupe tombe
  sur un mot, les scènes longues sont découpées en plans courts.
- `src/lib/render/ffmpeg.ts` traduit le plan en une seule commande FFmpeg : plans, zooms, logo, sous-titres ASS
  (polices du Brand Kit), voix nettoyée, musique qui baisse sous la voix, volume normalisé à -14 LUFS.

### Le contrôle qualité (11 tests)

| Moment | Tests |
| --- | --- |
| Avant le rendu | validité du plan, voix et scènes, Brand Kit, droits des fichiers |
| Après le rendu | fichier technique, images (noir, figé, flash), son, synchronisation, lisibilité, relecture IA |
| Avant publication | règles de chaque plateforme |

Un test rouge bloque la publication. Un test orange se valide avec « Garder tel quel ». Le moteur fait jusqu'à
3 tentatives (avec corrections automatiques) avant de montrer le résultat.

## Lancer en local

Prérequis : Node 22, PostgreSQL, FFmpeg et fontconfig (`fc-scan`).

```bash
cp .env.example .env          # les services simulés suffisent pour essayer
npm install
npm run db:migrate
npm run dev                   # le site sur http://localhost:3000
npm run worker                # dans un second terminal : le worker de montage
```

Ou tout en Docker : `docker compose up --build`.

## Tests

```bash
npm run lint && npm run typecheck
npm run test:unit             # sans base ni réseau
npm run test:integration      # base montage_test et FFmpeg réels (TEST_DATABASE_URL)
npm run build && npm run test:e2e   # parcours complet dans Chromium, micro simulé
```

Le parcours e2e crée un compte, écrit une idée, enregistre une prise au prompteur, lance un vrai rendu FFmpeg, valide
le contrôle qualité, publie (service simulé), puis exporte et supprime le compte.

## Mise en production

La CI (`.github/workflows/ci.yml`) lance lint, types, tests unitaires, tests d'intégration, parcours navigateur et
build Docker à chaque pull request. Après fusion sur `main`, `deploy.yml` publie l'image sur GHCR puis la met en ligne
sur le VPS par SSH (`deploy/vps/remote-deploy.sh`) :

- Docker est installé s'il manque, l'app est rangée dans `/opt/montage-video` (Postgres, worker, site sur
  `127.0.0.1:3100`). Le mot de passe de la base et `APP_SECRET` sont générés une fois sur le serveur.
- Le reverse proxy déjà présent (nginx, Caddy ou Apache) reçoit le sous-domaine, sans toucher aux autres sites, et
  certbot crée le certificat HTTPS. Si rien n'écoute sur 80/443, un Caddy est lancé dans Docker.

À configurer dans GitHub (Settings > Secrets and variables > Actions) :

| Nom | Type | Rôle |
| --- | --- | --- |
| `VPS_SSH_KEY` | secret, obligatoire | clé privée SSH autorisée sur le VPS |
| `APP_ENV` | secret, facultatif | lignes `CLE=valeur` de prod (clés Anthropic, Deepgram, Stripe, S3...) ; sans lui, l'app tourne avec les services simulés |
| `VPS_DOMAIN` | variable | sous-domaine, par défaut `montage.estebandimascio.fr` |
| `VPS_HOST`, `VPS_USER`, `VPS_PORT` | variables | par défaut `72.60.95.129`, `root`, `22` |
| `ACME_EMAIL` | variable | e-mail pour Let's Encrypt (facultatif) |

Le sous-domaine doit avoir un enregistrement DNS A vers l'IP du VPS. Pour retirer les services simulés, ajoute par
exemple `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=...` et `ALLOW_MOCK_IN_PRODUCTION=0` dans `APP_ENV`.

Le démarrage échoue volontairement si une clé indispensable manque en production. Les services simulés sont refusés
en production, sauf avec `ALLOW_MOCK_IN_PRODUCTION=1` (réglage par défaut du VPS tant que `APP_ENV` est vide).

Webhook Stripe : `https://<domaine>/api/stripe/webhook`, événements `checkout.session.completed`,
`customer.subscription.updated`, `customer.subscription.deleted`.

## À décider avant la mise en ligne

- Nom de l'app (`APP_NAME`) et domaine (`APP_URL`).
- Prix de l'offre Créateur (`CREATOR_PRICE_EUR`, et le prix Stripe correspondant).
- Quotas : vidéos par mois et durée maximale par offre, filigrane sur l'offre gratuite (`FREE_*`, `CREATOR_*`).
- Champs `[À COMPLÉTER]` des pages légales (`src/lib/legal.ts`), à faire relire par un professionnel du droit.
- Vidéo de démo de la page d'accueil (`NEXT_PUBLIC_DEMO_VIDEO_URL`) et captures (`public/captures/*.webp`).

## Sécurité

- Mots de passe hachés en Argon2id, sessions en cookie httpOnly, seule l'empreinte du jeton est stockée.
- Limitation des tentatives (connexion, inscription, mot de passe oublié, changement de mot de passe).
- Fichiers privés : chaque clé de stockage commence par l'identifiant du propriétaire, contrôlé à chaque lecture.
  Liens publics temporaires signés (HMAC) pour les plateformes.
- Imports vérifiés par extension et par les premiers octets du fichier, taille limitée.
- En-têtes de sécurité (CSP, HSTS, X-Frame-Options), vérification de l'origine sur les routes API.
- Suppression de compte : base et fichiers effacés, abonnement résilié. Export des données en JSON.
