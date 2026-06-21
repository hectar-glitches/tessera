import { mockApi } from "./mockData.js";

// VITE_API_URL is the production var (Vercel); VITE_API_BASE kept for back-compat.
const BASE = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE || "http://localhost:8000";
export const ORG = "ask-ddoski";
// Force offline/mock mode with VITE_USE_MOCK=1; otherwise we fall back to mock data
// only when a live request fails, so the dashboard always renders.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "1";

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

const qs = (params) => {
  const p = Object.entries(params || {}).filter(([, v]) => v != null && v !== "");
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "";
};

// Factory: build an API client bound to a given org. New OrgCache endpoints
// (trending / entries CRUD / role-aware query) live here. Every method degrades to
// mock data if the backend is unreachable (or VITE_USE_MOCK=1), satisfying the
// "works independently with mock data" constraint.
export function createApi(org) {
  const guard = async (fn, mockKey, ...args) => {
    if (USE_MOCK) return mockApi(org, mockKey, ...args);
    try {
      return await fn();
    } catch (e) {
      return mockApi(org, mockKey, ...args);
    }
  };
  return {
    org,
    health: () => guard(() => req(`/health`), "health"),
    info: () => guard(() => req(`/orgs/${org}/info`), "info"),
    ingestSeed: () => guard(() => req(`/orgs/${org}/ingest/seed`, { method: "POST" }), "ingestSeed"),
    ingest: (document) =>
      guard(() => req(`/orgs/${org}/ingest`, { method: "POST", body: JSON.stringify({ document }) }), "ingest"),
    guide: () => guard(() => req(`/orgs/${org}/guide`), "guide"),
    query: (question, opts = {}) =>
      guard(() => req(`/orgs/${org}/query`, {
        method: "POST",
        body: JSON.stringify({ question, ...opts }),
      }), "query", question, opts),
    stats: () => guard(() => req(`/orgs/${org}/stats`), "stats"),
    activity: (limit = 40) => guard(() => req(`/orgs/${org}/activity?limit=${limit}`), "activity"),
    confidenceCheck: () => guard(() => req(`/orgs/${org}/confidence-check`, { method: "POST" }), "confidenceCheck"),
    setBudget: (budget) =>
      guard(() => req(`/orgs/${org}/budget`, { method: "POST", body: JSON.stringify({ budget }) }), "setBudget"),
    reset: () => guard(() => req(`/orgs/${org}/reset`, { method: "POST" }), "reset"),
    // ---- OrgCache role-aware endpoints ----
    trending: (filters) => guard(() => req(`/orgs/${org}/trending${qs(filters)}`), "trending", filters),
    entries: (filters) => guard(() => req(`/orgs/${org}/entries${qs(filters)}`), "entries", filters),
    updateEntry: (hash, patch) =>
      guard(() => req(`/orgs/${org}/entries/${hash}`, { method: "PATCH", body: JSON.stringify(patch) }), "updateEntry", hash, patch),
    deleteEntry: (hash) =>
      guard(() => req(`/orgs/${org}/entries/${hash}`, { method: "DELETE" }), "deleteEntry", hash),
  };
}

// Back-compat: the legacy Chat UI imports `api` bound to the ask-ddoski demo org.
export const api = {
  health: () => req(`/health`),
  info: () => req(`/orgs/${ORG}/info`),
  ingestSeed: () => req(`/orgs/${ORG}/ingest/seed`, { method: "POST" }),
  ingest: (document) =>
    req(`/orgs/${ORG}/ingest`, { method: "POST", body: JSON.stringify({ document }) }),
  guide: () => req(`/orgs/${ORG}/guide`),
  query: (question, accept_hash = null, force_generate = false) =>
    req(`/orgs/${ORG}/query`, {
      method: "POST",
      body: JSON.stringify({ question, accept_hash, force_generate }),
    }),
  stats: () => req(`/orgs/${ORG}/stats`),
  activity: (limit = 40) => req(`/orgs/${ORG}/activity?limit=${limit}`),
  confidenceCheck: () => req(`/orgs/${ORG}/confidence-check`, { method: "POST" }),
  setBudget: (budget) =>
    req(`/orgs/${ORG}/budget`, { method: "POST", body: JSON.stringify({ budget }) }),
  reset: () => req(`/orgs/${ORG}/reset`, { method: "POST" }),
};
