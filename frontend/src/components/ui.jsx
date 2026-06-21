// Shared Tessera UI primitives — keeps the premium look consistent across sections.

// Section header: small medium label with a hairline extending to the right.
export function SectionHeader({ children, right }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-sm font-medium text-zinc-400 whitespace-nowrap">{children}</span>
      <span className="h-px flex-1 bg-line" />
      {right}
    </div>
  );
}

// Small neutral pill badge (role / seniority tags).
export function Tag({ children }) {
  if (!children) return null;
  return (
    <span className="inline-flex items-center rounded-md bg-zinc-800 px-1.5 py-0.5 text-[11px] font-medium capitalize text-zinc-300">
      {children}
    </span>
  );
}

// Elevated surface panel (no harsh border).
export function Panel({ className = "", children }) {
  return (
    <div className={`rounded-2xl bg-surface shadow-card p-6 ${className}`}>{children}</div>
  );
}

// relative-time formatter shared by tables/feeds.
export function fmtAgo(ts) {
  if (!ts) return "—";
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
