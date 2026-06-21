import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw, Play, Trash2, CheckCircle2, XCircle, ChevronDown,
} from "lucide-react";
import { createApi } from "../api.js";
import FilterBar from "./FilterBar.jsx";
import CacheHealth from "./CacheHealth.jsx";
import TrendingTable from "./TrendingTable.jsx";
import EntryManager from "./EntryManager.jsx";
import { Panel, SectionHeader } from "./ui.jsx";

const DEFAULT_ORG = import.meta.env.VITE_DEFAULT_ORG || "acmecorp";
const ORGS = [
  { id: "acmecorp", label: "AcmeCorp" },
  { id: "ask-ddoski", label: "Ask Ddoski" },
];

export default function Dashboard() {
  const [org, setOrg] = useState(DEFAULT_ORG);
  const [filters, setFilters] = useState({});
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);
  const [entryCount, setEntryCount] = useState(null);

  const client = useMemo(() => createApi(org), [org]);

  const refresh = useCallback(async () => {
    const [s, a, e] = await Promise.all([
      client.stats(),
      client.activity(40),
      client.entries(filters),
    ]);
    setStats(s);
    setEvents(a.events || []);
    setEntryCount((e.entries || []).length);
  }, [client, filters]);

  // Make sure the selected org is seeded before we render its data.
  useEffect(() => {
    let alive = true;
    client.info()
      .then((i) => { if (!i.chunks && !i.cache_size) return client.ingestSeed(); })
      .catch(() => {})
      .finally(() => { if (alive) refresh(); });
    return () => { alive = false; };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <span className="text-xs uppercase tracking-widelabel text-zinc-600">Org</span>
          <div className="relative">
            <select
              value={org}
              onChange={(e) => { setOrg(e.target.value); setFilters({}); }}
              className="appearance-none bg-surface rounded-lg pl-3 pr-8 py-1.5 text-sm text-zinc-200 border border-line hover:border-line-strong outline-none cursor-pointer"
            >
              {ORGS.map((o) => <option key={o.id} value={o.id} className="bg-surface">{o.label}</option>)}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          </div>
        </div>
        <button
          onClick={async () => { await client.reset(); await client.ingestSeed(); refresh(); }}
          className="text-xs flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <Trash2 size={13} /> Reset &amp; re-seed
        </button>
      </div>

      <FilterBar value={filters} onChange={setFilters} />

      <CacheHealth stats={stats} entryCount={entryCount} />

      <BudgetBar stats={stats} api={client} onChange={refresh} />

      <div className="grid lg:grid-cols-2 gap-5">
        <TrendingTable api={client} filters={filters} />
        <EntryManager api={client} filters={filters} />
      </div>

      <ActivityFeed events={events} />

      {org === "ask-ddoski" && <InvalidationDemo api={client} onDone={refresh} />}

      <ConfidencePanel api={client} />
    </div>
  );
}

function BudgetBar({ stats, api, onChange }) {
  const [budget, setBudget] = useState("");
  if (!stats) return null;
  const pct = Math.min(100, stats.budget_used_pct);
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-4 text-sm">
        <div className="text-zinc-400">
          <span className="font-semibold text-zinc-100 tabular">{stats.tokens_saved.toLocaleString()}</span>
          <span className="text-zinc-500"> tokens saved this month</span>
          <span className="text-zinc-700"> · </span>
          <span className="font-semibold text-green-500 tabular">${stats.saved_usd.toFixed(2)}</span>
          <span className="text-zinc-500"> saved</span>
          <span className="text-zinc-700"> · </span>
          <span className="font-semibold text-zinc-100 tabular">{stats.hit_rate_pct}%</span>
          <span className="text-zinc-500"> hit rate</span>
        </div>
        <div className="text-xs text-zinc-500 tabular shrink-0">
          ${stats.spend_usd.toFixed(2)} / ${stats.budget.toFixed(2)}
        </div>
      </div>
      <div className="h-0.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full bg-brand transition-all duration-500" style={{ width: `${Math.max(1, pct)}%` }} />
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={async (e) => { e.preventDefault(); if (budget) { await api.setBudget(parseFloat(budget)); setBudget(""); onChange(); } }}
      >
        <input
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="set budget"
          type="number"
          className="w-24 bg-transparent text-xs text-zinc-400 rounded-md border border-line focus:border-line-strong px-2 py-1 outline-none"
        />
        <button className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Update</button>
      </form>
    </div>
  );
}

const DECISION_DOT = {
  hit: "bg-green-500",
  suggest: "bg-amber-500",
  miss: "bg-blue-500",
};

function ActivityFeed({ events }) {
  return (
    <Panel>
      <SectionHeader>Activity</SectionHeader>
      {events.length === 0 ? (
        <div className="py-8 text-sm text-zinc-600 text-center">
          No activity yet — ask some questions.
        </div>
      ) : (
        <div className="relative max-h-[360px] overflow-y-auto scrollbar-thin pl-4">
          {/* vertical timeline line */}
          <span className="absolute left-[5px] top-1 bottom-1 w-px bg-line" aria-hidden />
          <div className="space-y-3.5">
            {events.map((e, i) => {
              const dot = DECISION_DOT[e.decision] || DECISION_DOT.miss;
              return (
                <div key={i} className="relative">
                  <span className={`absolute -left-[13px] top-1.5 h-2 w-2 rounded-full ring-4 ring-surface ${dot}`} />
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex-1 min-w-0 truncate text-sm text-zinc-200">{e.question}</span>
                    <span className="text-xs text-zinc-600 tabular shrink-0">sim {e.similarity.toFixed(2)}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {e.actor && <span className="text-zinc-400">{e.actor} · </span>}
                    {e.tokens_saved > 0 && `saved $${e.dollars_saved.toFixed(5)}`}
                    {e.note && `${e.tokens_saved > 0 ? " · " : ""}${e.note}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

function ConfidencePanel({ api }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      setData(await api.confidenceCheck());
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="border-t border-line pt-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <ChevronDown size={15} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
        Confidence check
      </button>

      {open && (
        <div className="animate-expand mt-4">
          <div className="flex items-center justify-between gap-4 mb-4">
            <p className="text-sm text-zinc-500 max-w-xl">
              Runs the test suite two ways: a vector-similarity-only baseline vs Tessera's
              entity-filtered hybrid. Watch the baseline's red Xs turn green.
            </p>
            <button
              onClick={run}
              disabled={running}
              className="shrink-0 text-xs flex items-center gap-1.5 rounded-lg border border-line hover:border-line-strong text-zinc-300 disabled:opacity-50 px-3 py-1.5 font-medium transition-colors"
            >
              {running ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
              Run confidence check
            </button>
          </div>

          {data && (
            <>
              <div className="grid grid-cols-2 gap-4 mb-3 max-w-md">
                <Score label="Baseline · vector only" pct={data.baseline_accuracy} tone="red" />
                <Score label="Tessera · hybrid" pct={data.hybrid_accuracy} tone="green" />
              </div>
              <div className="text-[11px] text-zinc-600 mb-2">
                embedder: {data.embedding_backend} · threshold {data.threshold} · {data.total_pairs} pairs
                <span className="text-zinc-700"> — col 1 = baseline, col 2 = hybrid</span>
              </div>
              <div className="space-y-1 max-h-[260px] overflow-y-auto scrollbar-thin">
                {data.results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-xs py-1.5 border-b border-line last:border-0">
                    <Mark ok={r.baseline_correct} />
                    <Mark ok={r.hybrid_correct} />
                    <span className="flex-1 truncate text-zinc-300">{r.probe}</span>
                    <span className="text-[10px] text-zinc-600">{r.bucket}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Score({ label, pct, tone }) {
  const c = tone === "green" ? "text-green-500" : "text-red-400";
  return (
    <div>
      <div className={`text-3xl font-semibold tabular ${c}`}>{Math.round(pct * 100)}%</div>
      <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
    </div>
  );
}

function Mark({ ok }) {
  return ok ? (
    <CheckCircle2 size={14} className="text-green-500 shrink-0" />
  ) : (
    <XCircle size={14} className="text-red-500 shrink-0" />
  );
}

function InvalidationDemo({ api, onDone }) {
  const [doc, setDoc] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.guide().then((g) => setDoc(g.document)).catch(() => {});
  }, [api]);

  async function reingest() {
    setBusy(true);
    try {
      const r = await api.ingest(doc);
      setResult(r);
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <SectionHeader>Source-aware cache invalidation</SectionHeader>
      <p className="text-sm text-zinc-500 mb-3">
        Edit the guide and re-ingest. Tessera diffs chunk hashes and drops <i>only</i> the
        cache entries derived from changed sections — everything else stays instant.
      </p>
      <textarea
        value={doc}
        onChange={(e) => setDoc(e.target.value)}
        spellCheck={false}
        className="w-full h-44 bg-canvas border border-line rounded-xl p-3 text-xs font-mono text-zinc-300 outline-none focus:border-brand scrollbar-thin"
      />
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={reingest}
          disabled={busy}
          className="text-sm flex items-center gap-1.5 bg-brand hover:opacity-90 text-white disabled:opacity-50 rounded-lg px-3 py-1.5 font-medium transition-opacity"
        >
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
          Re-ingest
        </button>
        {result && (
          <div className="text-xs text-zinc-500">
            <b className="text-zinc-200">{result.changed_chunks.length}</b> chunks changed ·
            <b className="text-red-400"> {result.invalidated_cache_hashes.length}</b> cache entries invalidated
            {result.changed_chunks.length > 0 && (
              <span className="text-zinc-700"> ({result.changed_chunks.join(", ")})</span>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
