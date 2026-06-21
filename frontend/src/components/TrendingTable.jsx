import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Panel, SectionHeader, Tag, fmtAgo } from "./ui.jsx";

// Trending FAQ list for the selected segment. Click a row to expand the full answer.
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
    <Panel>
      <SectionHeader>Trending</SectionHeader>
      {items.length === 0 ? (
        <div className="py-8 text-sm text-zinc-600 text-center">
          No trending questions for this segment yet.
        </div>
      ) : (
        <div className="-mx-2">
          {items.map((it) => (
            <Row
              key={it.hash}
              it={it}
              open={open === it.hash}
              onToggle={() => setOpen(open === it.hash ? null : it.hash)}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function Row({ it, open, onToggle }) {
  return (
    <div className="rounded-lg hover:bg-zinc-900 transition-colors">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-2 py-2.5 text-left"
      >
        <span className="text-zinc-600">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="flex-1 min-w-0 truncate text-sm text-zinc-200">{it.question}</span>
        <span className="hidden sm:flex items-center gap-1.5">
          <Tag>{it.role}</Tag>
          <Tag>{it.seniority}</Tag>
        </span>
        <span className="w-12 text-right font-mono text-sm text-zinc-300 tabular">{it.count}</span>
        <span className="w-20 text-right text-xs text-zinc-500">{fmtAgo(it.timestamp)}</span>
      </button>
      {open && (
        <div className="animate-expand px-2 pb-3 pl-9 text-[13px] text-zinc-400 whitespace-pre-wrap">
          {it.answer}
        </div>
      )}
    </div>
  );
}
