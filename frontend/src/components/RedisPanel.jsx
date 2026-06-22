import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Boxes, Network, Timer, Cpu, KeyRound } from "lucide-react";
import { Panel, SectionHeader } from "./ui.jsx";

const LEVEL_COLOR = {
  public: "text-slate-400 bg-slate-500/10",
  employee: "text-sky-300 bg-sky-500/10",
  manager: "text-amber-300 bg-amber-500/10",
  exec: "text-rose-300 bg-rose-500/10",
};

function fmtTTL(s) {
  if (s == null) return "no expiry";
  if (s <= 0) return "expired";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export default function RedisPanel({ api }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [, setTick] = useState(0); // re-render every second so TTLs count down
  const fetchedAt = useRef(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.redisInternals();
      setData(d);
      fetchedAt.current = Date.now();
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const resync = setInterval(load, 12000);
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => { clearInterval(resync); clearInterval(tick); };
  }, [load]);

  if (!data) return null;
  const isRedis = data.backend === "redis";
  const elapsed = Math.floor((Date.now() - fetchedAt.current) / 1000);
  const live = (s) => (s == null ? null : s - elapsed);

  return (
    <Panel>
      <SectionHeader right={<RefreshBtn onClick={load} loading={loading} />}>
        Redis under the hood
      </SectionHeader>

      {!isRedis ? (
        <MemoryFallback data={data} />
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-zinc-500 -mt-1">
            Not just a key-value cache: vector KNN with an ACL prefilter, a chunk&rarr;answer
            reverse index, and native per-entry expiry &mdash; all in one Redis.
          </p>

          <div className="grid sm:grid-cols-3 gap-3">
            <Stat icon={Network} label="Vector index"
              value={data.index?.num_docs ?? "—"}
              sub={`${data.index?.algorithm} · ${data.index?.distance_metric} · ${data.index?.vector_dim}d`} />
            <Stat icon={Boxes} label="Cache entries"
              value={data.keys?.cache_entries ?? "—"}
              sub={`${data.keys?.chunks ?? "—"} source chunks indexed`} />
            <Stat icon={KeyRound} label="Reverse-index sets"
              value={data.keys?.reverse_index_sets ?? "—"}
              sub="chunk → answers (invalidation map)" />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            <span className="font-mono text-zinc-400">{data.index?.name}</span>
            {data.server?.redis_version && (
              <span className="flex items-center gap-1"><Cpu size={11} /> v{data.server.redis_version}</span>
            )}
            {data.server?.used_memory_human && <span>{data.server.used_memory_human} used</span>}
            {(data.modules || []).map((m) => (
              <span key={m} className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">{m}</span>
            ))}
          </div>

          {data.reverse_index_sample && (
            <div className="rounded-xl bg-canvas border border-line p-3 text-xs">
              <div className="text-zinc-500 mb-1">Reverse index (event-driven invalidation)</div>
              <div className="font-mono text-zinc-300">
                chunkmap:<span className="text-brand">{data.reverse_index_sample.chunk_id}</span>
                <span className="text-zinc-600"> → </span>
                <span className="text-amber-300">{data.reverse_index_sample.cache_entries_pointing_here}</span>
                <span className="text-zinc-500"> cached answer(s)</span>
              </div>
              <div className="text-[11px] text-zinc-600 mt-1">
                Edit that source chunk and only those answers drop — nothing else.
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 text-xs text-zinc-400 mb-2">
              <Timer size={13} /> Per-entry expiry — sensitivity-tiered, ticking live
            </div>
            {(data.sample_ttls || []).length === 0 ? (
              <div className="text-xs text-zinc-600">No cache entries yet — ask some questions.</div>
            ) : (
              <div className="space-y-1">
                {data.sample_ttls.map((s) => (
                  <div key={s.hash} className="flex items-center gap-3 text-xs py-1 border-b border-line last:border-0">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${LEVEL_COLOR[s.level] || LEVEL_COLOR.public}`}>
                      {s.level}
                    </span>
                    <span className="font-mono text-zinc-500 flex-1 truncate">{s.hash}</span>
                    <span className="tabular text-zinc-300">{fmtTTL(live(s.ttl_seconds))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <TierLegend tiers={data.ttl_tiers} />
        </div>
      )}
    </Panel>
  );
}

function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-xl bg-canvas border border-line px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widelabel text-zinc-500">{label}</span>
        <Icon size={14} className="text-zinc-700" />
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular text-zinc-100">{value}</div>
      <div className="text-[11px] text-zinc-500 mt-0.5">{sub}</div>
    </div>
  );
}

function TierLegend({ tiers }) {
  if (!tiers) return null;
  const order = ["public", "employee", "manager", "exec"];
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 border-t border-line pt-3">
      <span className="text-zinc-600">TTL tiers:</span>
      {order.filter((l) => tiers[l] != null).map((l) => (
        <span key={l} className={`rounded px-1.5 py-0.5 ${LEVEL_COLOR[l]}`}>
          {l} {fmtTTL(tiers[l])}
        </span>
      ))}
      <span className="text-zinc-600">— more sensitive expires sooner</span>
    </div>
  );
}

function MemoryFallback({ data }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs px-3 py-2">
        {data.note || "Redis is not connected — showing the in-memory fallback."}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Stat icon={Boxes} label="Cache entries" value={data.keys?.cache_entries ?? "—"} sub="in-memory" />
        <Stat icon={Network} label="Source chunks" value={data.keys?.chunks ?? "—"} sub="in-memory" />
        <Stat icon={KeyRound} label="Reverse-index sets" value={data.keys?.reverse_index_sets ?? "—"} sub="in-memory" />
      </div>
      <TierLegend tiers={data.ttl_tiers} />
    </div>
  );
}

function RefreshBtn({ onClick, loading }) {
  return (
    <button
      onClick={onClick}
      className="text-xs flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
    >
      <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
    </button>
  );
}
