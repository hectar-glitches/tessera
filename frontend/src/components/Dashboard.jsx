import { useCallback, useEffect, useState } from "react";
import {
  DollarSign, PiggyBank, Zap, ShieldCheck, RefreshCw, Activity,
  Play, FileEdit, Trash2, CheckCircle2, XCircle,
} from "lucide-react";
import { api } from "../api.js";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [events, setEvents] = useState([]);

  const refresh = useCallback(async () => {
    const [s, a] = await Promise.all([api.stats(), api.activity(40)]);
    setStats(s);
    setEvents(a.events);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={PiggyBank} color="emerald" label="Saved by cache"
          value={stats ? `$${stats.saved_usd.toFixed(4)}` : "—"}
          sub={stats ? `${stats.tokens_saved.toLocaleString()} tokens` : ""} />
        <Stat icon={DollarSign} color="indigo" label="Spent on generation"
          value={stats ? `$${stats.spend_usd.toFixed(4)}` : "—"}
          sub={stats ? `${stats.tokens_spent.toLocaleString()} tokens` : ""} />
        <Stat icon={Zap} color="amber" label="Cache hit rate"
          value={stats ? `${stats.hit_rate_pct}%` : "—"}
          sub={stats ? `${stats.hits} hits / ${stats.total_requests} reqs` : ""} />
        <Stat icon={ShieldCheck} color="sky" label="Near-miss catches"
          value={stats ? `${stats.suggests}` : "—"}
          sub="routed to safety popup" />
      </div>

      <BudgetBar stats={stats} onChange={refresh} />

      <div className="grid lg:grid-cols-2 gap-5">
        <ActivityFeed events={events} />
        <ConfidencePanel />
      </div>

      <InvalidationDemo onDone={refresh} />

      <div className="flex justify-end">
        <button
          onClick={async () => { await api.reset(); await api.ingestSeed(); refresh(); }}
          className="text-xs flex items-center gap-1.5 text-slate-400 hover:text-rose-300"
        >
          <Trash2 size={14} /> Reset org &amp; re-seed
        </button>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, color, label, value, sub }) {
  const ring = {
    emerald: "text-emerald-400 bg-emerald-500/10",
    indigo: "text-indigo-400 bg-indigo-500/10",
    amber: "text-amber-400 bg-amber-500/10",
    sky: "text-sky-400 bg-sky-500/10",
  }[color];
  return (
    <div className="bg-panel border border-edge rounded-2xl p-4">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${ring}`}>
        <Icon size={18} />
      </div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-sm text-slate-300">{label}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}

function BudgetBar({ stats, onChange }) {
  const [budget, setBudget] = useState("");
  if (!stats) return null;
  const pct = stats.budget_used_pct;
  const bar = pct > 85 ? "bg-rose-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="bg-panel border border-edge rounded-2xl p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium">Monthly budget</div>
        <div className="text-sm text-slate-400">
          ${stats.spend_usd.toFixed(4)} / ${stats.budget.toFixed(2)} used
        </div>
      </div>
      <div className="h-3 rounded-full bg-ink overflow-hidden">
        <div className={`h-full ${bar} transition-all`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <div className="flex items-center justify-between mt-3">
        <div className="text-xs text-slate-500">
          Without the cache you'd have spent
          <b className="text-slate-300"> ${(stats.spend_usd + stats.saved_usd).toFixed(4)}</b>.
          The cache cut that by <b className="text-emerald-400">
            {stats.spend_usd + stats.saved_usd > 0
              ? Math.round((stats.saved_usd / (stats.spend_usd + stats.saved_usd)) * 100)
              : 0}%</b>.
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={async (e) => { e.preventDefault(); if (budget) { await api.setBudget(parseFloat(budget)); setBudget(""); onChange(); } }}
        >
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="set $ budget"
            type="number"
            className="w-28 bg-ink border border-edge rounded-lg px-2 py-1 text-xs outline-none focus:border-indigo-500"
          />
          <button className="text-xs bg-ink border border-edge rounded-lg px-2 py-1 hover:border-indigo-500">
            Update
          </button>
        </form>
      </div>
    </div>
  );
}

const DECISION_STYLE = {
  hit: { c: "text-emerald-400", b: "bg-emerald-500/10", label: "CACHE HIT" },
  suggest: { c: "text-amber-400", b: "bg-amber-500/10", label: "NEAR-MISS" },
  miss: { c: "text-indigo-400", b: "bg-indigo-500/10", label: "GENERATED" },
};

function ActivityFeed({ events }) {
  return (
    <div className="bg-panel border border-edge rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Activity size={16} className="text-slate-400" />
        <span className="font-medium">Recent activity</span>
      </div>
      <div className="space-y-2 max-h-[340px] overflow-y-auto scrollbar-thin">
        {events.length === 0 && (
          <div className="text-sm text-slate-500">No activity yet — ask Ddoski some questions.</div>
        )}
        {events.map((e, i) => {
          const st = DECISION_STYLE[e.decision] || DECISION_STYLE.miss;
          return (
            <div key={i} className="flex items-start gap-3 bg-ink border border-edge rounded-xl px-3 py-2">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${st.b} ${st.c} mt-0.5`}>
                {st.label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{e.question}</div>
                <div className="text-[11px] text-slate-500">
                  sim {e.similarity.toFixed(2)}
                  {e.tokens_saved > 0 && ` · saved $${e.dollars_saved.toFixed(5)}`}
                  {e.note && ` · ${e.note}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConfidencePanel() {
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
    <div className="bg-panel border border-edge rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-sky-400" />
          <span className="font-medium">Confidence check</span>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="text-xs flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg px-3 py-1.5 font-medium"
        >
          {running ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
          Run suite
        </button>
      </div>

      {!data && (
        <p className="text-sm text-slate-500">
          Runs the hand-built test suite two ways: vector-similarity-only baseline vs
          Tessera's entity-filtered hybrid. Watch the baseline's red Xs turn green.
        </p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Score label="Baseline (vector only)" pct={data.baseline_accuracy} tone="rose" />
            <Score label="Tessera hybrid" pct={data.hybrid_accuracy} tone="emerald" />
          </div>
          <div className="text-[11px] text-slate-500 mb-2">
            embedder: {data.embedding_backend} · threshold {data.threshold} · {data.total_pairs} pairs
          </div>
          <div className="space-y-1 max-h-[260px] overflow-y-auto scrollbar-thin">
            {data.results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-ink border border-edge rounded-lg px-2 py-1.5">
                <Mark ok={r.baseline_correct} />
                <Mark ok={r.hybrid_correct} />
                <span className="flex-1 truncate">{r.probe}</span>
                <span className="text-[10px] text-slate-600">{r.bucket}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-2 text-[10px] text-slate-500">
            <span>col 1 = baseline</span><span>col 2 = hybrid</span>
          </div>
        </>
      )}
    </div>
  );
}

function Score({ label, pct, tone }) {
  const c = tone === "emerald" ? "text-emerald-400" : "text-rose-400";
  return (
    <div className="bg-ink border border-edge rounded-xl p-3">
      <div className={`text-2xl font-semibold ${c}`}>{Math.round(pct * 100)}%</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

function Mark({ ok }) {
  return ok ? (
    <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
  ) : (
    <XCircle size={14} className="text-rose-500 shrink-0" />
  );
}

function InvalidationDemo({ onDone }) {
  const [doc, setDoc] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.guide().then((g) => setDoc(g.document)).catch(() => {});
  }, []);

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
    <div className="bg-panel border border-edge rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <FileEdit size={16} className="text-slate-400" />
        <span className="font-medium">Source-aware cache invalidation</span>
      </div>
      <p className="text-sm text-slate-500 mb-3">
        Edit the guide and re-ingest. Tessera diffs chunk hashes and drops <i>only</i> the
        cache entries derived from changed sections — everything else stays instant.
      </p>
      <textarea
        value={doc}
        onChange={(e) => setDoc(e.target.value)}
        spellCheck={false}
        className="w-full h-44 bg-ink border border-edge rounded-xl p-3 text-xs font-mono outline-none focus:border-indigo-500 scrollbar-thin"
      />
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={reingest}
          disabled={busy}
          className="text-sm flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg px-3 py-1.5 font-medium"
        >
          {busy ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Re-ingest
        </button>
        {result && (
          <div className="text-xs text-slate-400">
            <b className="text-slate-200">{result.changed_chunks.length}</b> chunks changed ·
            <b className="text-rose-300"> {result.invalidated_cache_hashes.length}</b> cache entries invalidated
            {result.changed_chunks.length > 0 && (
              <span className="text-slate-600"> ({result.changed_chunks.join(", ")})</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
