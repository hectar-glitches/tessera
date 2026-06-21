import { createClerkClient } from "@clerk/backend";
import type { Request, Response, NextFunction } from "express";
import { db } from "@acme/db";
import { users } from "@acme/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "@acme/shared/logger";
import crypto from "node:crypto";

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });

export interface AuthedRequest extends Request {
  userId: string;
  teamId: string | null;
}

// Session token auth — used by the web frontend (ClerkProvider sets the cookie).
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "missing token" });

  try {
    const payload = await clerk.verifyToken(token);
    const user = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!user.length || user[0].deletedAt) return res.status(401).json({ error: "user not found" });

    (req as AuthedRequest).userId = payload.sub;
    (req as AuthedRequest).teamId = user[0].teamId;
    logger.info("auth.ok", { userId: payload.sub, path: req.path });
    next();
  } catch (err) {
    logger.warn("auth.failed", { path: req.path, err: String(err) });
    return res.status(401).json({ error: "invalid token" });
  }
}

// API key auth — used for service-to-service calls.
// Keys are stored in AWS Secrets Manager under prod/app as SHA-256 hashes.
export async function validateApiKey(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["x-api-key"] as string | undefined;
  if (!key) return res.status(401).json({ error: "missing api key" });

  const hash = crypto.createHash("sha256").update(key).digest("hex");
  // In prod, look up hash against Secrets Manager. Stub for local dev:
  if (hash !== process.env.SERVICE_API_KEY_HASH) {
    logger.warn("apikey.rejected", { path: req.path });
    return res.status(401).json({ error: "invalid api key" });
  }
  next();
}

// Webhook auth — Svix signature verification.
export function validateWebhook(req: Request, res: Response, next: NextFunction) {
  const svixId = req.headers["svix-id"] as string;
  const svixTs = req.headers["svix-timestamp"] as string;
  const svixSig = req.headers["svix-signature"] as string;
  if (!svixId || !svixTs || !svixSig) return res.status(400).json({ error: "missing svix headers" });

  const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const toSign = `${svixId}.${svixTs}.${body}`;
  const expected = crypto
    .createHmac("sha256", process.env.SVIX_WEBHOOK_SECRET!)
    .update(toSign)
    .digest("base64");

  const signatures = svixSig.split(" ").map((s) => s.replace(/^v1,/, ""));
  if (!signatures.includes(expected)) return res.status(401).json({ error: "invalid signature" });
  next();
}
