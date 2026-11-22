/**
 * Textes légaux. Les champs [À COMPLÉTER] doivent être remplis avant la mise en ligne,
 * et l'ensemble relu par un professionnel du droit.
 */

export type LegalSection = { title: string; paragraphs: string[] };
export type LegalPage = { slug: string; title: string; updatedAt: string; sections: LegalSection[] };

const APP = process.env.APP_NAME || "[Nom de l'app]";

export const LEGAL_PAGES: LegalPage[] = [
  {
    slug: "mentions-legales",
    title: "Mentions légales",
    updatedAt: "[À COMPLÉTER : date]",
    sections: [
      {
        title: "Éditeur du site",
        paragraphs: [
          `Le site et l'application ${APP} sont édités par [À COMPLÉTER : nom ou raison sociale], [À COMPLÉTER : forme juridique, par exemple SAS ou entreprise individuelle] au capital de [À COMPLÉTER] euros.`,
          "Siège social : [À COMPLÉTER : adresse complète].",
          "Immatriculation : [À COMPLÉTER : RCS ou RNE, ville et numéro SIREN].",
          "Numéro de TVA intracommunautaire : [À COMPLÉTER].",
          "E-mail : [À COMPLÉTER]. Téléphone : [À COMPLÉTER].",
        ],
      },
      {
        title: "Directeur de la publication",
        paragraphs: ["[À COMPLÉTER : prénom et nom], en qualité de [À COMPLÉTER : fonction]."],
      },
      {
        title: "Hébergeur",
        paragraphs: [
          "Le site est hébergé par [À COMPLÉTER : nom de l'hébergeur], [À COMPLÉTER : adresse], [À COMPLÉTER : téléphone].",
          "Les fichiers des utilisateurs sont stockés par [À COMPLÉTER : prestataire de stockage et pays des serveurs].",
        ],
      },
      {
        title: "Propriété intellectuelle",
        paragraphs: [
          `Le nom ${APP}, le logo, l'interface et le code du site appartiennent à l'éditeur. Toute reproduction sans autorisation écrite est interdite.`,
          "Les vidéos, fichiers et textes importés ou créés par les utilisateurs restent leur propriété. Voir les CGV.",
          "Les polices Bricolage Grotesque, IBM Plex Sans, Anton, Bebas Neue, Archivo Black, DM Serif Display, Abril Fatface et Poppins sont utilisées sous licence SIL Open Font License 1.1, Luckiest Guy sous licence Apache 2.0.",
        ],
      },
      {
        title: "Contact",
        paragraphs: ["Pour toute question sur le site, écris à [À COMPLÉTER : adresse e-mail de contact]."],
      },
    ],
  },
  {
    slug: "confidentialite",
    title: "Confidentialité",
    updatedAt: "[À COMPLÉTER : date]",
    sections: [
      {
        title: "Qui est responsable de tes données",
        paragraphs: [
          "Le responsable du traitement est [À COMPLÉTER : nom ou raison sociale], [À COMPLÉTER : adresse].",
          "Pour toute demande sur tes données, écris à [À COMPLÉTER : adresse e-mail dédiée]. Délégué à la protection des données : [À COMPLÉTER ou « aucun désigné »].",
        ],
      },
      {
        title: "Les données que nous traitons",
        paragraphs: [
          "Ton compte : ton adresse e-mail et ton mot de passe, stocké sous forme chiffrée (hachage Argon2). Nous ne connaissons jamais ton mot de passe.",
          "Tes contenus : les idées et scripts que tu écris, les fichiers que tu importes (logos, images, vidéos, musiques, polices), tes enregistrements au prompteur et les vidéos produites.",
          "Ton abonnement : ton offre et l'identifiant client chez notre prestataire de paiement. Nous ne stockons jamais ta carte bancaire.",
          "Les données techniques : adresse IP et journaux de connexion, pour la sécurité du service.",
        ],
      },
      {
        title: "Pourquoi et sur quelle base",
        paragraphs: [
          "Fournir le service (créer, monter, vérifier et publier tes vidéos) : exécution du contrat.",
          "Sécuriser le service (limiter les tentatives de connexion, détecter les abus) : intérêt légitime.",
          "Facturer et tenir la comptabilité : obligation légale.",
          "Nous n'utilisons pas tes données pour de la publicité. Nous ne les vendons pas.",
        ],
      },
      {
        title: "Ta voix et tes vidéos",
        paragraphs: [
          "Tes enregistrements servent uniquement à monter tes vidéos : transcription pour placer les sous-titres et les coupes.",
          "Ta voix n'est pas clonée. Tes contenus ne servent pas à entraîner un modèle d'IA, ni chez nous ni chez nos prestataires (option de non-utilisation activée chez le prestataire de transcription).",
        ],
      },
      {
        title: "Nos prestataires",
        paragraphs: [
          "Hébergement de l'application : [À COMPLÉTER : prestataire et pays].",
          "Stockage des fichiers : [À COMPLÉTER : prestataire et pays].",
          "Écriture du script, choix des plans et relecture des images : Anthropic (États-Unis).",
          "Transcription de la voix : Deepgram (États-Unis).",
          "Paiement : Stripe (Irlande et États-Unis).",
          "Publication sur les réseaux, si tu l'utilises : Ayrshare (États-Unis).",
          "E-mails de service : Resend (États-Unis).",
          "Les transferts hors de l'Union européenne sont encadrés par les clauses contractuelles types de la Commission européenne ou par le Data Privacy Framework. [À VÉRIFIER pour chaque prestataire avant la mise en ligne.]",
        ],
      },
      {
        title: "Combien de temps",
        paragraphs: [
          "Ton compte et tes contenus : tant que ton compte est ouvert. Quand tu le supprimes, tout est effacé immédiatement de notre base et sous 30 jours des sauvegardes.",
          "Les données de facturation : 10 ans, comme l'exige le Code de commerce.",
          "Les journaux techniques : 12 mois au plus.",
        ],
      },
      {
        title: "Tes droits",
        paragraphs: [
          "Tu peux accéder à tes données, les corriger, les effacer, les récupérer dans un format lisible, t'opposer à un traitement ou en demander la limitation. Tu peux aussi donner des directives sur le sort de tes données après ton décès.",
          "Depuis ton compte, tu peux télécharger toutes tes données et supprimer ton compte toi-même.",
          "Pour le reste, écris à [À COMPLÉTER : adresse e-mail dédiée]. Nous répondons sous un mois.",
          "Si tu estimes que tes droits ne sont pas respectés, tu peux saisir la CNIL (cnil.fr).",
        ],
      },
      {
        title: "Cookies",
        paragraphs: [
          "Le site utilise un seul cookie : celui qui garde ta session ouverte. Il est indispensable au service, il ne demande donc pas de consentement.",
          "Aucun cookie publicitaire ni de mesure d'audience n'est déposé.",
        ],
      },
      {
        title: "Âge minimum",
        paragraphs: ["Le service est réservé aux personnes de 15 ans et plus."],
      },
    ],
  },
  {
    slug: "cgv",
    title: "CGV",
    updatedAt: "[À COMPLÉTER : date]",
    sections: [
      {
        title: "Objet",
        paragraphs: [
          `Ces conditions générales de vente et d'utilisation encadrent l'usage de ${APP}, un service en ligne qui crée des vidéos courtes à partir d'une idée, de fichiers et de la voix de l'utilisateur.`,
          "Le service est édité par [À COMPLÉTER : nom ou raison sociale]. Voir les mentions légales.",
          "Créer un compte vaut acceptation de ces conditions.",
        ],
      },
      {
        title: "Compte",
        paragraphs: [
          "Tu dois avoir 15 ans au moins et donner une adresse e-mail valide. Tu es responsable de la confidentialité de ton mot de passe.",
          "Un compte est personnel. Il ne peut pas être partagé ni revendu.",
        ],
      },
      {
        title: "Offres et prix",
        paragraphs: [
          "L'offre Gratuit est sans engagement et sans paiement. Elle comprend un nombre limité de vidéos par mois, indiqué sur la page Tarifs.",
          "L'offre Créateur est un abonnement mensuel au prix affiché sur la page Tarifs, en euros toutes taxes comprises : [À COMPLÉTER : prix].",
          "Le quota de vidéos est remis à zéro le premier jour de chaque mois. Les vidéos non utilisées ne sont pas reportées.",
          "Nous pouvons modifier les prix. Le nouveau prix s'applique à la période suivante, après une information envoyée 30 jours avant.",
        ],
      },
      {
        title: "Paiement",
        paragraphs: [
          "Le paiement se fait par carte bancaire, via notre prestataire Stripe. L'abonnement est prélevé chaque mois à la date anniversaire.",
          "En cas d'échec de paiement, l'offre repasse en Gratuit après plusieurs tentatives. Tes vidéos restent accessibles.",
        ],
      },
      {
        title: "Durée et résiliation",
        paragraphs: [
          "L'abonnement est conclu pour un mois et se renouvelle automatiquement. Tu peux le résilier à tout moment depuis ton compte.",
          "La résiliation prend effet à la fin du mois en cours. Le mois commencé n'est pas remboursé, sauf exercice du droit de rétractation.",
        ],
      },
      {
        title: "Droit de rétractation",
        paragraphs: [
          "Si tu es un consommateur, tu disposes de 14 jours après la souscription pour te rétracter, sans justification, en écrivant à [À COMPLÉTER : adresse e-mail].",
          "Si tu demandes à utiliser l'offre Créateur avant la fin de ce délai, tu paies seulement la part du service utilisée jusqu'à ta rétractation (article L221-25 du Code de la consommation).",
        ],
      },
      {
        title: "Tes contenus",
        paragraphs: [
          "Les fichiers que tu importes, tes enregistrements et les vidéos produites t'appartiennent.",
          "Tu nous autorises à les stocker, les traiter et les transmettre à nos prestataires, uniquement pour fournir le service. Cette autorisation prend fin quand tu supprimes le contenu ou ton compte.",
          "Tu garantis avoir les droits sur tout ce que tu importes : images, musiques, polices, logos, personnes filmées. Tu indiques ces droits dans ta bibliothèque. Le contrôle qualité bloque la publication d'un fichier aux droits inconnus.",
        ],
      },
      {
        title: "Usage acceptable",
        paragraphs: [
          "Il est interdit de créer des contenus illicites, haineux, violents, trompeurs, portant atteinte à la vie privée ou aux droits d'autrui, ou imitant une personne sans son accord.",
          "Nous pouvons suspendre un compte qui ne respecte pas ces règles, après t'avoir prévenu sauf urgence.",
        ],
      },
      {
        title: "L'IA et le contrôle qualité",
        paragraphs: [
          "Le script, le montage et les légendes sont proposés par une IA. Ils peuvent contenir des erreurs. Tu relis et tu valides avant de publier : tu restes responsable de ce que tu publies.",
          "Le contrôle qualité automatique réduit les erreurs techniques mais ne garantit pas leur absence.",
        ],
      },
      {
        title: "Publication sur les réseaux",
        paragraphs: [
          "La publication passe par les comptes que tu relies. Les règles de TikTok, Instagram et YouTube s'appliquent. Nous ne sommes pas responsables d'un refus ou d'un retrait décidé par une plateforme.",
        ],
      },
      {
        title: "Disponibilité et responsabilité",
        paragraphs: [
          "Nous faisons de notre mieux pour que le service soit disponible en continu, sans pouvoir le garantir. Des interruptions pour maintenance peuvent avoir lieu.",
          "Garde une copie de tes fichiers importants. Notre responsabilité est limitée aux dommages directs, dans la limite des sommes payées sur les 12 derniers mois, sauf faute lourde ou disposition légale contraire.",
        ],
      },
      {
        title: "Données personnelles",
        paragraphs: ["Le traitement de tes données est décrit dans la page Confidentialité."],
      },
      {
        title: "Médiation et litiges",
        paragraphs: [
          "En cas de litige, écris-nous d'abord à [À COMPLÉTER : adresse e-mail]. Si nous ne trouvons pas de solution, tu peux saisir gratuitement le médiateur de la consommation : [À COMPLÉTER : nom et site du médiateur].",
          "Ces conditions sont soumises au droit français. À défaut d'accord, les tribunaux français sont compétents.",
        ],
      },
    ],
  },
];

export function legalPage(slug: string): LegalPage | undefined {
  return LEGAL_PAGES.find((p) => p.slug === slug);
}
