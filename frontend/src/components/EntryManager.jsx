import { useCallback, useEffect, useState } from "react";
import { ListChecks, Save, Trash2, AlertTriangle, X } from "lucide-react";

const STALE_DAYS = 30;
const isStale = (ts) => ts && (Date.now() / 1000 - ts) > STALE_DAYS * 86400;

// Cache Entry Manager: list, inline-edit answer, set min_seniority_level, delete.
// Edit/Delete/Set-Level are feature-flagged off when the backend write endpoints are
// unavailable (detected via a probe of api.updateEntry support).
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
    <div className="bg-panel border border-edge rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <ListChecks size={16} className="text-indigo-400" />
        <span className="font-medium">Cache entry manager</span>
        <span className="text-xs text-slate-500">{entries.length} entries</span>
        {!writable && (
          <span className="text-[10px] text-amber-400 bg-amber-500/10 rounded px-1.5 py-0.5 ml-auto">
            read-only (backend pending)
          </span>
        )}
      </div>
      <div className="space-y-2 max-h-[420px] overflow-y-auto scrollbar-thin">
        {entries.length === 0 && <div className="text-sm text-slate-500">No entries for this segment.</div>}
        {entries.map((e) => (
          <div key={e.hash} className="bg-ink border border-edge rounded-xl px-3 py-2">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {e.question}
                  {isStale(e.created_at) && (
                    <span title="Older than 30 days" className="text-amber-400 inline-flex items-center gap-0.5 text-[10px]">
                      <AlertTriangle size={11} /> stale
                    </span>
                  )}
                </div>
                {editing === e.hash ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      value={draft}
                      onChange={(ev) => setDraft(ev.target.value)}
                      className="flex-1 bg-panel border border-edge rounded-lg px-2 py-1 text-xs outline-none focus:border-indigo-500"
                    />
                    <button onClick={() => saveAnswer(e.hash)} className="text-emerald-400 hover:text-emerald-300"><Save size={15} /></button>
                    <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-slate-300"><X size={15} /></button>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 truncate">{e.answer}</div>
                )}
                <div className="text-[11px] text-slate-600 mt-1 flex items-center gap-2 flex-wrap">
                  <span className="capitalize">{e.role || "—"}</span>
                  <span>·</span>
                  <span className="capitalize">{e.seniority || "—"}</span>
                  <span>·</span>
                  <span>{e.hit_count} hits</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="text-[11px] text-slate-500 flex items-center gap-1">
                  L
                  <select
                    disabled={!writable}
                    value={e.min_seniority_level}
                    onChange={(ev) => setLevel(e.hash, ev.target.value)}
                    className="bg-panel border border-edge rounded px-1 py-0.5 text-xs disabled:opacity-40"
                  >
                    {[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
                <button
                  disabled={!writable}
                  onClick={() => { setEditing(e.hash); setDraft(e.answer); }}
                  className="text-slate-400 hover:text-indigo-300 disabled:opacity-40"
                  title="Edit answer"
                >
                  <Save size={14} className="rotate-0" />
                </button>
                <button
                  disabled={!writable}
                  onClick={() => remove(e.hash)}
                  className="text-slate-400 hover:text-rose-300 disabled:opacity-40"
                  title="Delete entry"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
