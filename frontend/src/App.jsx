import { useEffect, useState } from "react";
import Dashboard from "./components/Dashboard.jsx";
import { api } from "./api.js";

export default function App() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: "down" }));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 select-none">
            <span className="text-xl font-semibold tracking-tightish text-brand">Tessera</span>
            <span className="hidden lg:inline text-xs text-zinc-600">
              Admin Dashboard
            </span>
          </div>

          <div className="flex items-center gap-3">
            <StatusDots health={health} />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        <Dashboard />
      </main>
    </div>
  );
}

function StatusDots({ health }) {
  if (!health) return null;
  const ok = health.status === "ok";
  const dots = ok
    ? [
        { label: "online", on: true },
        { label: health.store_backend, on: true },
        { label: health.embedding_backend, on: health.embedding_backend !== "fallback" },
        { label: health.llm_available ? "claude" : "stub", on: health.llm_available },
      ]
    : [{ label: "offline", on: false }];
  return (
    <div className="hidden md:flex items-center gap-1.5">
      {dots.map((d, i) => (
        <span
          key={i}
          className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-zinc-400"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              d.on ? "bg-green-500" : "bg-zinc-600"
            }`}
          />
          {d.label}
        </span>
      ))}
    </div>
  );
}
