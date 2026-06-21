import { useEffect, useRef, useState } from "react";
import { UserCircle2, ChevronDown, Check } from "lucide-react";

export const LEVEL_STYLE = {
  public: "text-slate-400 bg-slate-500/10",
  employee: "text-sky-300 bg-sky-500/10",
  manager: "text-amber-300 bg-amber-500/10",
  exec: "text-rose-300 bg-rose-500/10",
};

export function LevelBadge({ level, teams = [] }) {
  const cls = LEVEL_STYLE[level] || LEVEL_STYLE.public;
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>
      {level}
      {teams && teams.length > 0 && ` · ${teams.join(", ")}`}
    </span>
  );
}

export default function IdentitySwitcher({ identities, identity, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-ink border border-edge rounded-xl px-3 py-1.5 text-sm hover:border-indigo-500"
      >
        <UserCircle2 size={18} className="text-indigo-400" />
        <span className="text-left leading-tight">
          <span className="block font-medium">{identity.user}</span>
          <span className="block text-[10px] text-slate-400">
            {identity.role} · {identity.team}
          </span>
        </span>
        <LevelBadge level={identity.level} />
        <ChevronDown size={14} className="text-slate-500" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-panel border border-edge rounded-xl shadow-xl z-20 overflow-hidden">
          <div className="px-3 py-2 text-[11px] text-slate-500 border-b border-edge">
            Switch identity — the cache is scoped to who's asking
          </div>
          {identities.map((p) => {
            const active = p.user === identity.user;
            return (
              <button
                key={p.user}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-ink ${
                  active ? "bg-ink" : ""
                }`}
              >
                <UserCircle2 size={18} className="text-slate-400 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium truncate">
                    {p.user} <span className="text-slate-500 font-normal">· {p.role}</span>
                  </span>
                  <span className="block text-[10px] text-slate-500">team: {p.team}</span>
                </span>
                <LevelBadge level={p.level} />
                {active && <Check size={14} className="text-emerald-400 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
