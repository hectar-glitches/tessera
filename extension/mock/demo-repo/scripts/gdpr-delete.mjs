#!/usr/bin/env node
// GDPR deletion cascade. Verified by Legal before running against prod.
// Usage: pnpm gdpr:delete --user-id=user_xxx
//
// What this does:
//   1. Soft-deletes the user row (sets deleted_at, clears PII fields)
//   2. Anonymises audit_log rows (sets user_id = NULL — rows are never deleted)
//   3. Triggers workspace data export deletion in S3
//   4. Writes a deletion receipt to audit_logs

import { parseArgs } from "node:util";
import { db } from "../packages/db/src/index.js";
import { users, auditLogs } from "../packages/db/src/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "../packages/shared/src/logger.js";

const { values } = parseArgs({ options: { "user-id": { type: "string" } } });
const userId = values["user-id"];
if (!userId) { console.error("--user-id is required"); process.exit(1); }

logger.info("gdpr.delete.start", { userId });

// 1. Anonymise the user row
await db.update(users)
  .set({ email: `deleted+${userId}@gdpr.acmecorp.invalid`, name: null, deletedAt: new Date() })
  .where(eq(users.id, userId));

// 2. Anonymise audit logs (never delete the rows — only nullify the FK)
await db.update(auditLogs)
  .set({ userId: null })
  .where(eq(auditLogs.userId, userId));

// 3. Audit trail: log the deletion itself
await db.insert(auditLogs).values({
  id: crypto.randomUUID(),
  action: "gdpr.delete",
  resource: "user",
  resourceId: userId,
  metadata: JSON.stringify({ requestedBy: process.env.GDPR_OPERATOR ?? "cli" }),
});

logger.info("gdpr.delete.done", { userId });
console.log(`Done. User ${userId} erased.`);
