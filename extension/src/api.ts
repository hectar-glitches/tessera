// Thin OrgCache backend client. All calls are best-effort: on any failure they return
// null/empty so the extension degrades silently (never throws into the editor).
import { levelForSeniority } from "./helpers";

export interface UserContext {
  serverUrl: string;
  org: string;
  role: string;
  seniority: string;
  tenure: string;
}

export interface CheckResult {
  decision: "hit" | "suggest" | "miss";
  cached: boolean;
  answer: string | null;
  similarity: number;
  matched_question: string | null;
}

export interface TrendingItem {
  hash: string;
  question: string;
  answer: string;
  count: number;
  role: string;
  seniority: string;
}

async function getJson(url: string, opts: any, log?: (m: string) => void): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) {
      log?.(`request failed: ${res.status} ${url}`);
      return null;
    }
    return await res.json();
  } catch (e: any) {
    log?.(`request error: ${e?.message || e}`);
    return null;
  }
}

export async function checkCache(
  ctx: UserContext,
  question: string,
  log?: (m: string) => void,
): Promise<CheckResult | null> {
  const body = {
    question,
    role: ctx.role,
    seniority: ctx.seniority,
    tenure: ctx.tenure,
    user_level: levelForSeniority(ctx.seniority),
  };
  return getJson(`${ctx.serverUrl}/api/orgs/${ctx.org}/check`, {
    method: "POST",
    body: JSON.stringify(body),
  }, log);
}

export async function getTrending(
  ctx: UserContext,
  log?: (m: string) => void,
): Promise<TrendingItem[]> {
  const params = new URLSearchParams({
    role: ctx.role,
    seniority: ctx.seniority,
    tenure: ctx.tenure,
    limit: "5",
  });
  const data = await getJson(
    `${ctx.serverUrl}/api/orgs/${ctx.org}/trending?${params.toString()}`,
    {},
    log,
  );
  return data?.items ?? [];
}
