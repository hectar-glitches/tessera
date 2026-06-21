import { useEffect, useState } from "react";
import { TrendingUp, ChevronDown, ChevronRight } from "lucide-react";

const fmtAgo = (ts) => {
  if (!ts) return "—";
  const s = Date.now() / 1000 - ts;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

// Trending FAQ table for the selected segment. Click a row to expand the full answer.
export default function TrendingTable({ api, filters }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    let alive = true;
    api.trending({ ...filters, limit: 10 }).then((d) => {
      if (alive) setItems(d.items || []);
    });
    return () => { alive = false; };
  }, [api, filters]);

  return (
    <div className="bg-panel border border-edge rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={16} className="text-emerald-400" />
        <span className="font-medium">Trending FAQs</span>
        <span className="text-xs text-slate-500">for this segment</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-2"></th>
              <th className="py-2 pr-2">Question</th>
              <th className="py-2 pr-2">Role</th>
              <th className="py-2 pr-2">Seniority</th>
              <th className="py-2 pr-2 text-right">Hits</th>
              <th className="py-2 pr-2 text-right">Last asked</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-slate-500 text-center">No trending questions for this segment yet.</td></tr>
            )}
            {items.map((it) => (
              <RowGroup key={it.hash} it={it} open={open === it.hash} onToggle={() => setOpen(open === it.hash ? null : it.hash)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowGroup({ it, open, onToggle }) {
  return (
    <>
      <tr className="border-t border-edge hover:bg-ink/60 cursor-pointer" onClick={onToggle}>
        <td className="py-2 pr-2 text-slate-500">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        <td className="py-2 pr-2 max-w-[260px] truncate">{it.question}</td>
        <td className="py-2 pr-2 capitalize text-slate-300">{it.role || "—"}</td>
        <td className="py-2 pr-2 capitalize text-slate-300">{it.seniority || "—"}</td>
        <td className="py-2 pr-2 text-right font-semibold text-emerald-400">{it.count}</td>
        <td className="py-2 pr-2 text-right text-slate-500">{fmtAgo(it.timestamp)}</td>
      </tr>
      {open && (
        <tr className="bg-ink/40">
          <td></td>
          <td colSpan={5} className="py-2 pr-4 text-slate-300 text-[13px] whitespace-pre-wrap">{it.answer}</td>
        </tr>
      )}
    </>
  );
}
