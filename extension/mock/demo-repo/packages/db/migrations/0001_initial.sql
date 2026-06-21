-- Migration: 0001_initial
-- Created by Drizzle Kit. Apply with: pnpm db:migrate
-- WARNING: never run db:reset against staging or prod.

CREATE TYPE "role" AS ENUM ('admin', 'member', 'viewer');

CREATE TABLE "teams" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "plan" text NOT NULL DEFAULT 'starter',
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "users" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL UNIQUE,
  "name" text,
  "role" "role" NOT NULL DEFAULT 'member',
  "team_id" text REFERENCES "teams"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);

CREATE TABLE "workspaces" (
  "id" text PRIMARY KEY NOT NULL,
  "team_id" text NOT NULL REFERENCES "teams"("id"),
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Audit log — rows must never be deleted (GDPR anonymises user_id to NULL instead)
CREATE TABLE "audit_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text,
  "action" text NOT NULL,
  "resource" text NOT NULL,
  "resource_id" text,
  "metadata" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
