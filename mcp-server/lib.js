// Core OrgCache MCP logic, decoupled from the stdio transport so it can be unit
// tested directly. Each tool calls the OrgCache HTTP API (see devin/api-contract.md)
// and degrades to a structured error object instead of throwing.

export const ORGCACHE_URL = process.env.ORGCACHE_URL || "http://localhost:8000";
export const ORG = process.env.ORGCACHE_ORG || "acmecorp";

const SENIORITY_LEVEL = { junior: 1, mid: 2, senior: 3, staff: 4, principal: 5 };

export function levelFor(seniority) {
  return seniority ? SENIORITY_LEVEL[seniority] ?? null : null;
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${ORGCACHE_URL}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text}`);
  }
  return res.json();
}

const qs = (params) => {
  const p = Object.entries(params || {}).filter(([, v]) => v != null && v !== "");
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "";
};

// check_cache(question, role, seniority, tenure) -> { hit, answer|null, similarity }
export async function checkCache({ question, role, seniority, tenure }) {
  try {
    const body = {
      question,
      role,
      seniority,
      tenure,
      user_level: levelFor(seniority),
    };
    const r = await apiFetch(`/orgs/${ORG}/check`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return {
      hit: r.decision === "hit",
      answer: r.decision === "hit" ? r.answer : null,
      similarity: r.similarity ?? 0,
    };
  } catch (e) {
    return { hit: false, answer: null, similarity: 0, error: String(e.message || e) };
  }
}

// store_answer(question, answer, role, seniority, tenure) -> { stored, hash }
// NOTE: the public backend has no verbatim-write endpoint, so we trigger a
// force-generate so a cache entry is created for this question/segment. The provided
// `answer` text is persisted verbatim only by the mock backend (see README limitations).
export async function storeAnswer({ question, answer, role, seniority, tenure }) {
  try {
    const r = await apiFetch(`/orgs/${ORG}/store`, {
      method: "POST",
      body: JSON.stringify({ question, answer, role, seniority, tenure,
        user_level: levelFor(seniority) }),
    });
    return { stored: true, hash: r.hash ?? "" };
  } catch (e) {
    // Fall back to a force-generate so an entry exists for the question.
    try {
      const r = await apiFetch(`/orgs/${ORG}/query`, {
        method: "POST",
        body: JSON.stringify({ question, role, seniority, tenure,
          user_level: levelFor(seniority), force_generate: true }),
      });
      return { stored: true, hash: r.matched_question ? "" : "", note: "generated entry", answer: r.answer };
    } catch (e2) {
      return { stored: false, hash: "", error: String(e2.message || e2) };
    }
  }
}

// get_trending(role, seniority, tenure) -> { items: [...] }
export async function getTrending({ role, seniority, tenure } = {}) {
  try {
    const r = await apiFetch(`/orgs/${ORG}/trending${qs({ role, seniority, tenure, limit: 10 })}`);
    return { items: r.items || [] };
  } catch (e) {
    return { items: [], error: String(e.message || e) };
  }
}
