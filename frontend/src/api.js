const BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";
export const ORG = "ask-ddoski";

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

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
