import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { Panel, SectionHeader, Tag } from "./ui.jsx";

const STALE_DAYS = 30;
const isStale = (ts) => ts && (Date.now() / 1000 - ts) > STALE_DAYS * 86400;

// Cache Entry Manager: list, inline-edit answer, set min_seniority_level, delete.
// Divider-separated rows; action icons reveal on hover.
export default function EntryManager({ api, filters, writable = true }) {
  const [entries, setEntries] = useState([]);
  const [editing, setEditing] = useState(null); // hash being edited
  const [draft, setDraft] = useState("");

  const load = useCallback(() => {
    api.entries(filters).then((d) => setEntries(d.entries || []));
  }, [api, filters]);

  useEffect(() => { load(); }, [load]);

  async function saveAnswer(hash) {
    await api.updateEntry(hash, { answer: draft });
    setEditing(null);
    load();
  }
  async function setLevel(hash, level) {
    await api.updateEntry(hash, { min_seniority_level: Number(level) });
    load();
  }
  async function remove(hash) {
    if (!window.confirm("Delete this cache entry?")) return;
    await api.deleteEntry(hash);
    load();
  }

  return (
    <Panel>
      <SectionHeader
        right={<span className="text-xs text-zinc-600 tabular">{entries.length}</span>}
      >
        Entries
      </SectionHeader>
      <div className="max-h-[420px] overflow-y-auto scrollbar-thin divide-y divide-line -my-1">
        {entries.length === 0 && (
          <div className="py-8 text-sm text-zinc-600 text-center">No entries for this segment.</div>
        )}
        {entries.map((e) => (
          <div key={e.hash} className="group py-3 -mx-2 px-2 rounded-lg hover:bg-zinc-900 transition-colors">
            <div className="flex items-center gap-2">
              {isStale(e.created_at) && (
                <span title="Older than 30 days" className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
              )}
              <span className="flex-1 min-w-0 truncate text-sm font-medium text-zinc-200">
                {e.question}
              </span>
              <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <input
                  type="number"
                  min={1}
                  max={5}
                  disabled={!writable}
                  value={e.min_seniority_level}
                  onChange={(ev) => setLevel(e.hash, ev.target.value)}
                  title="Minimum seniority level"
                  className="w-10 bg-transparent text-center text-xs text-zinc-400 rounded border border-line focus:border-line-strong outline-none disabled:opacity-40"
                />
                <button
                  disabled={!writable}
                  onClick={() => { setEditing(e.hash); setDraft(e.answer); }}
                  className="text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
                  title="Edit answer"
                >
                  <Pencil size={14} />
                </button>
                <button
                  disabled={!writable}
                  onClick={() => remove(e.hash)}
                  className="text-zinc-500 hover:text-red-400 disabled:opacity-40"
                  title="Delete entry"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {editing === e.hash ? (
              <div className="flex items-center gap-2 mt-2">
                <input
                  value={draft}
                  onChange={(ev) => setDraft(ev.target.value)}
                  className="flex-1 bg-canvas rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 border border-line focus:border-brand outline-none"
                />
                <button onClick={() => saveAnswer(e.hash)} className="text-green-500 hover:text-green-400"><Check size={15} /></button>
                <button onClick={() => setEditing(null)} className="text-zinc-500 hover:text-zinc-300"><X size={15} /></button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-xs text-zinc-500">{e.answer}</span>
                <Tag>{e.role}</Tag>
                <Tag>{e.seniority}</Tag>
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
