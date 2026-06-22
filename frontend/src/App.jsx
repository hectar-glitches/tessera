import { useEffect, useState } from "react";
import Chat from "./components/Chat.jsx";
import Dashboard from "./components/Dashboard.jsx";
import IdentitySwitcher from "./components/IdentitySwitcher.jsx";
import { api } from "./api.js";

export default function App() {
  const [tab, setTab] = useState("chat");
  const [health, setHealth] = useState(null);
  const [seeded, setSeeded] = useState(false);
  const [identities, setIdentities] = useState([]);
  const [identity, setIdentity] = useState(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: "down" }));
    api.info().then((i) => setSeeded(i.chunks > 0)).catch(() => {});
    api.identities()
      .then((d) => {
        setIdentities(d.identities);
        setIdentity(d.identities[0]);
      })
      .catch(() => {});
  }, []);

  async function ensureSeed() {
    if (!seeded) {
      await api.ingestSeed();
      setSeeded(true);
    }
  }
  useEffect(() => {
    ensureSeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded]);

  // Exchange the selected persona for a server-signed token. Identity is then derived
  // from the signed claims on the backend — the client can't assert its own clearance.
  useEffect(() => {
    if (identity?.user) api.login(identity.user).catch(() => {});
  }, [identity]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 select-none">
            <span className="text-xl font-semibold tracking-tightish text-brand">Tessera</span>
            <span className="hidden lg:inline text-xs text-zinc-600">
              Institutional knowledge, instantly.
            </span>
          </div>

          <nav className="flex items-center gap-1 rounded-full bg-surface border border-line p-1">
            <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
              Ask Ddoski
            </TabButton>
            <TabButton active={tab === "dash"} onClick={() => setTab("dash")}>
              Admin
            </TabButton>
          </nav>

          <div className="flex items-center gap-3">
            {tab === "chat" && identity && (
              <IdentitySwitcher
                identities={identities}
                identity={identity}
                onChange={setIdentity}
              />
            )}
            <StatusDots health={health} />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {tab === "chat" ? (
          <Chat key={identity?.user} identity={identity} />
        ) : (
          <Dashboard />
        )}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
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
