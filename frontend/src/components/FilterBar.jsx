import { Users, Layers, Clock } from "lucide-react";

const ROLES = ["engineer", "designer", "pm", "devops", "manager"];
const SENIORITIES = ["junior", "mid", "senior", "staff", "principal"];
const TENURES = ["onboarding", "experienced"];

// Top-of-dashboard filter bar. Owns the role/seniority/tenure selection that every
// OrgCache section below filters by.
export default function FilterBar({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value || undefined });
  return (
    <div className="bg-panel border border-edge rounded-2xl p-4 flex flex-wrap items-center gap-3">
      <span className="text-sm text-slate-400 mr-1">Segment</span>
      <Dropdown icon={Users} value={value.role} onChange={set("role")} options={ROLES} placeholder="All roles" />
      <Dropdown icon={Layers} value={value.seniority} onChange={set("seniority")} options={SENIORITIES} placeholder="All seniorities" />
      <Dropdown icon={Clock} value={value.tenure} onChange={set("tenure")} options={TENURES} placeholder="All tenures" />
      {(value.role || value.seniority || value.tenure) && (
        <button
          onClick={() => onChange({})}
          className="text-xs text-slate-400 hover:text-rose-300 ml-auto"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function Dropdown({ icon: Icon, value, onChange, options, placeholder }) {
  return (
    <label className="flex items-center gap-2 bg-ink border border-edge rounded-lg px-2.5 py-1.5">
      <Icon size={14} className="text-slate-500" />
      <select
        value={value || ""}
        onChange={onChange}
        className="bg-transparent text-sm outline-none text-slate-200 capitalize"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o} className="bg-ink capitalize">{o}</option>
        ))}
      </select>
    </label>
  );
}
