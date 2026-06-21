import { createClient } from "redis";
import { TTL } from "@acme/api/cache/ttl";
import { logger } from "./logger";

const client = createClient({ url: process.env.REDIS_URL });
client.on("error", (e) => logger.error("redis.error", { err: String(e) }));

export async function connectCache() {
  await client.connect();
}

export async function cache<T>(
  key: string,
  ttlSeconds: number,
  fetch: () => Promise<T>,
): Promise<T> {
  const hit = await client.get(key);
  if (hit) return JSON.parse(hit) as T;

  const value = await fetch();
  // Probabilistic early expiry: recompute for ~10% of requests in the last 10% of TTL.
  // Prevents stampedes when a popular key expires under load.
  const jitter = Math.random() < 0.1 ? Math.floor(ttlSeconds * 0.1) : 0;
  await client.setEx(key, ttlSeconds - jitter, JSON.stringify(value));
  return value;
}

export async function invalidate(tag: string) {
  // Scan for all keys prefixed by tag and delete them.
  const keys: string[] = [];
  for await (const key of client.scanIterator({ MATCH: `${tag}:*`, COUNT: 100 })) {
    keys.push(key);
  }
  if (keys.length) await client.del(keys);
  logger.info("cache.invalidate", { tag, count: keys.length });
}
