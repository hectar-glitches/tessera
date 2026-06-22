import { pgTable, text, timestamp, integer, boolean, pgEnum } from "drizzle-orm/pg-core";

// @pii — fields marked with this decorator are subject to GDPR deletion cascade.
// Run `pnpm gdpr:delete --user-id=X` to trigger (verified by Legal before exec).

export const roleEnum = pgEnum("role", ["admin", "member", "viewer"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),                // @pii Clerk user ID
  email: text("email").notNull().unique(),    // @pii
  name: text("name"),                         // @pii
  role: roleEnum("role").notNull().default("member"),
  teamId: text("team_id").references(() => teams.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),         // soft delete — GDPR erasure sets this
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("starter"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id"),                    // nullable — system actions have no user
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: text("resource_id"),
  metadata: text("metadata"),                 // JSON
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Never delete audit_logs rows. GDPR deletion anonymises userId to NULL.
});
