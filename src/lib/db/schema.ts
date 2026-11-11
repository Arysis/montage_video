import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Directions } from "@/lib/plan/directions";
import type { EditPlan } from "@/lib/plan/schema";
import type { QcReport } from "@/lib/qc/types";
import type { Script } from "@/lib/script/schema";
import type { WordTiming } from "@/lib/stt/types";

export const planEnum = pgEnum("plan", ["free", "creator"]);
export const assetKindEnum = pgEnum("asset_kind", [
  "logo",
  "character",
  "video",
  "image",
  "music",
  "font",
  "voice",
]);
export const rightsEnum = pgEnum("asset_rights", ["own", "licensed", "free", "unknown"]);
export const formatEnum = pgEnum("video_format", ["9:16", "1:1", "16:9"]);
export const projectStatusEnum = pgEnum("project_status", [
  "draft",
  "script",
  "prompteur",
  "montage",
  "ready",
  "scheduled",
  "published",
]);
export const renderStatusEnum = pgEnum("render_status", ["idle", "queued", "running", "done", "failed"]);
export const publicationStatusEnum = pgEnum("publication_status", [
  "scheduled",
  "publishing",
  "published",
  "failed",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    firstName: text("first_name"),
    plan: planEnum("plan").notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    publishProfileKey: text("publish_profile_key"),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_idx").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // hash SHA-256 du jeton, jamais le jeton lui-même
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResets = pgTable("password_resets", {
  id: text("id").primaryKey(), // hash du jeton
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

export type BrandColor = { name: string; hex: string };

export const brandKits = pgTable("brand_kits", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  logoAssetId: uuid("logo_asset_id"),
  logoDarkAssetId: uuid("logo_dark_asset_id"),
  colors: jsonb("colors").$type<BrandColor[]>().notNull().default([]),
  titleFont: text("title_font").notNull().default("Bricolage Grotesque"),
  bodyFont: text("body_font").notNull().default("IBM Plex Sans"),
  subtitleStyle: text("subtitle_style").$type<"boxed" | "outline" | "word">().notNull().default("boxed"),
  subtitlePosition: text("subtitle_position").$type<"bottom" | "center">().notNull().default("bottom"),
  ...timestamps,
});

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: assetKindEnum("kind").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    rights: rightsEnum("rights").notNull().default("own"),
    durationSec: real("duration_sec"),
    width: integer("width"),
    height: integer("height"),
    description: text("description"),
    fontFamily: text("font_family"),
    /** Vignette JPEG pour la bibliothèque. */
    thumbKey: text("thumb_key"),
    /** Version utilisable par le moteur de rendu (ex. logo SVG converti en PNG). */
    renderKey: text("render_key"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("assets_user_idx").on(t.userId, t.kind)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    idea: text("idea").notNull(),
    format: formatEnum("format").notNull().default("9:16"),
    platforms: text("platforms")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    targetDurationSec: integer("target_duration_sec").notNull().default(30),
    status: projectStatusEnum("status").notNull().default("draft"),
    script: jsonb("script").$type<Script>(),
    selectedTakeId: uuid("selected_take_id"),
    editPlan: jsonb("edit_plan").$type<EditPlan>(),
    directions: jsonb("directions").$type<Directions>(),
    planVersion: integer("plan_version").notNull().default(0),
    renderStatus: renderStatusEnum("render_status").notNull().default("idle"),
    renderProgress: integer("render_progress").notNull().default(0),
    renderMessage: text("render_message"),
    renderKey: text("render_key"),
    renderDurationSec: real("render_duration_sec"),
    renderSizeBytes: integer("render_size_bytes"),
    qcReport: jsonb("qc_report").$type<QcReport>(),
    acknowledgedWarnings: text("acknowledged_warnings")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    caption: text("caption"),
    hashtags: text("hashtags"),
    /** Date à laquelle la vidéo a été comptée dans le quota du mois (premier montage lancé). */
    countedAt: timestamp("counted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("projects_user_idx").on(t.userId, t.updatedAt)],
);

export const projectAssets = pgTable(
  "project_assets",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.assetId] })],
);

export const takes = pgTable(
  "takes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    storageKey: text("storage_key").notNull(),
    mime: text("mime").notNull(),
    durationSec: real("duration_sec").notNull(),
    stoppedAtLine: integer("stopped_at_line"),
    complete: boolean("complete").notNull().default(false),
    words: jsonb("words").$type<WordTiming[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("takes_project_idx").on(t.projectId)],
);

export const socialAccounts = pgTable(
  "social_accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").$type<"tiktok" | "instagram" | "youtube">().notNull(),
    handle: text("handle").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.platform] })],
);

export const publications = pgTable(
  "publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platforms: text("platforms").array().notNull(),
    caption: text("caption").notNull(),
    hashtags: text("hashtags").notNull().default(""),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: publicationStatusEnum("status").notNull().default("scheduled"),
    externalIds: jsonb("external_ids").$type<Record<string, string>>(),
    error: text("error"),
    ...timestamps,
  },
  (t) => [index("publications_user_idx").on(t.userId, t.scheduledAt)],
);

export type User = typeof users.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Take = typeof takes.$inferSelect;
export type BrandKit = typeof brandKits.$inferSelect;
export type Publication = typeof publications.$inferSelect;
