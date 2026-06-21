const ROLES = ["engineer", "designer", "pm", "devops", "manager"];
const SENIORITIES = ["junior", "mid", "senior", "staff", "principal"];
const TENURES = ["onboarding", "experienced"];

// Top-of-dashboard filter bar. Horizontal pill groups (not form controls) — owns the
// role/seniority/tenure selection that every section below filters by.
export default function FilterBar({ value, onChange }) {
  const pick = (k) => (v) => onChange({ ...value, [k]: v });
  const active = value.role || value.seniority || value.tenure;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <PillGroup options={ROLES} value={value.role} onChange={pick("role")} />
      <Divider />
      <PillGroup options={SENIORITIES} value={value.seniority} onChange={pick("seniority")} />
      <Divider />
      <PillGroup options={TENURES} value={value.tenure} onChange={pick("tenure")} />
      {active && (
        <button
          onClick={() => onChange({})}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function Divider() {
  return <span className="h-5 w-px bg-line" aria-hidden />;
}

function PillGroup({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      <Pill selected={!value} onClick={() => onChange(undefined)}>All</Pill>
      {options.map((o) => (
        <Pill key={o} selected={value === o} onClick={() => onChange(o)}>
          {o}
        </Pill>
      ))}
    </div>
  );
}

function Pill({ selected, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
        selected
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}
