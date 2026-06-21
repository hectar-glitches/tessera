import { Database, Zap, PiggyBank, DollarSign } from "lucide-react";

const COST_PER_TOKEN = 0.000015; // $ per token, per the spec's savings formula

// Four metric cards summarizing cache health for the current segment.
export default function CacheHealth({ stats, entryCount }) {
  const tokensSaved = stats?.tokens_saved ?? 0;
  const dollarSavings = (stats?.saved_usd ?? tokensSaved * COST_PER_TOKEN) || 0;
  const cards = [
    { icon: Database, color: "sky", label: "Entries in cache", value: entryCount ?? stats?.cache_size ?? "—", sub: "for current segment" },
    { icon: Zap, color: "amber", label: "Hit rate (recent)", value: stats ? `${stats.hit_rate_pct}%` : "—", sub: stats ? `${stats.hits} hits / ${stats.total_requests} reqs` : "" },
    { icon: PiggyBank, color: "emerald", label: "Tokens saved", value: tokensSaved.toLocaleString(), sub: "vs. calling the agent" },
    { icon: DollarSign, color: "indigo", label: "Dollar savings", value: `$${dollarSavings.toFixed(4)}`, sub: `@ $${COST_PER_TOKEN}/token` },
  ];
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <Card key={c.label} {...c} />
      ))}
    </div>
  );
}

function Card({ icon: Icon, color, label, value, sub }) {
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
