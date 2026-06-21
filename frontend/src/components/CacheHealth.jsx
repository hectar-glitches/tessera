import { Database, Zap, PiggyBank, DollarSign } from "lucide-react";

const COST_PER_TOKEN = 0.000015; // $ per token, per the spec's savings formula

// Four metric cards summarizing cache health for the current segment. Elevated
// (shadow, no border), spacious, typography-led.
export default function CacheHealth({ stats, entryCount }) {
  const tokensSaved = stats?.tokens_saved ?? 0;
  const dollarSavings = (stats?.saved_usd ?? tokensSaved * COST_PER_TOKEN) || 0;
  const cards = [
    { icon: Database, label: "Entries in cache", value: entryCount ?? stats?.cache_size ?? "—", sub: "for current segment" },
    { icon: Zap, label: "Hit rate", value: stats ? `${stats.hit_rate_pct}%` : "—", sub: stats ? `${stats.hits} hits / ${stats.total_requests} reqs` : "" },
    { icon: PiggyBank, label: "Tokens saved", value: tokensSaved.toLocaleString(), sub: "vs. calling the agent" },
    { icon: DollarSign, label: "Dollar savings", value: `$${dollarSavings.toFixed(4)}`, sub: `@ $${COST_PER_TOKEN}/token` },
  ];
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <Card key={c.label} {...c} />
      ))}
    </div>
  );
}

function Card({ icon: Icon, label, value, sub }) {
  return (
    <div className="group rounded-2xl bg-surface shadow-card hover:shadow-card-hover transition-shadow px-6 py-8">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-widelabel text-zinc-500">
          {label}
        </div>
        <Icon size={16} className="text-zinc-700 group-hover:text-zinc-600 transition-colors" />
      </div>
      <div className="mt-4 text-4xl font-semibold tracking-tightish text-zinc-100 tabular">
        {value}
      </div>
      <div className="mt-1 text-xs text-zinc-500">{sub}</div>
    </div>
  );
}
