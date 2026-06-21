import { NextRequest, NextResponse } from "next/server";
import { validateWebhook } from "@acme/api/middleware/auth";
import { db } from "@acme/db";
import { users, teams } from "@acme/db/schema";
import { sendWelcomeEmail } from "@acme/jobs/email-notification";
import { logger } from "@acme/shared/logger";
import crypto from "node:crypto";

// Clerk sends user.created / user.deleted / session.* events here.
// Auth is Svix signature verification (see validateWebhook in auth.ts).

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headers = Object.fromEntries(req.headers);

  // Verify Svix signature
  const toSign = `${headers["svix-id"]}.${headers["svix-timestamp"]}.${body}`;
  const expected = crypto
    .createHmac("sha256", process.env.SVIX_WEBHOOK_SECRET!)
    .update(toSign)
    .digest("base64");
  const sigs = (headers["svix-signature"] ?? "").split(" ").map((s: string) => s.replace(/^v1,/, ""));
  if (!sigs.includes(expected)) {
    logger.warn("webhook.clerk.invalid-signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(body);
  logger.info("webhook.clerk.received", { type: event.type });

  if (event.type === "user.created") {
    const { id, email_addresses, first_name, last_name } = event.data;
    const email = email_addresses[0]?.email_address;
    await db.insert(users).values({ id, email, name: `${first_name} ${last_name}`.trim() });

    // Fire-and-forget welcome email via Trigger.dev
    await sendWelcomeEmail.trigger({ userId: id, email, name: first_name ?? "" });
  }

  if (event.type === "user.deleted") {
    // Soft-delete: set deletedAt, anonymise audit log user_id via GDPR cascade.
    // Full erasure: run `pnpm gdpr:delete --user-id=X`
    logger.info("webhook.clerk.user-deleted", { userId: event.data.id });
  }

  return NextResponse.json({ received: true });
}
