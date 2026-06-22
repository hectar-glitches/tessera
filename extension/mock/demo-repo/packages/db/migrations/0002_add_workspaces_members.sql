-- Migration: 0002_add_workspace_members
-- Adds workspace-level membership so users can belong to multiple workspaces.

CREATE TABLE "workspace_members" (
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "role" NOT NULL DEFAULT 'member',
  "joined_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("workspace_id", "user_id")
);

CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");
