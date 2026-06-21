import { useEffect, useState } from "react";
import { MessageSquare, LayoutDashboard, Brain, Circle } from "lucide-react";
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

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-edge bg-panel/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="text-indigo-400" size={26} />
            <div>
              <div className="font-semibold tracking-tight text-lg leading-none">
                Tessera
              </div>
              <div className="text-xs text-slate-400">token-aware FAQ infrastructure</div>
            </div>
          </div>

          <nav className="flex items-center gap-1 bg-ink rounded-xl p-1 border border-edge">
            <TabButton active={tab === "chat"} onClick={() => setTab("chat")} icon={MessageSquare}>
              Ask Ddoski
            </TabButton>
            <TabButton active={tab === "dash"} onClick={() => setTab("dash")} icon={LayoutDashboard}>
              Admin Dashboard
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
            <HealthPill health={health} />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-5 py-6">
        {tab === "chat" ? (
          <Chat key={identity?.user} identity={identity} />
        ) : (
          <Dashboard />
        )}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition ${
        active ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"
      }`}
    >
      <Icon size={16} /> {children}
    </button>
  );
}

function HealthPill({ health }) {
  if (!health) return null;
  const ok = health.status === "ok";
  return (
    <div className="hidden md:flex items-center gap-3 text-xs text-slate-400">
      <span className="flex items-center gap-1.5">
        <Circle size={8} className={ok ? "fill-emerald-400 text-emerald-400" : "fill-rose-500 text-rose-500"} />
        {ok ? "online" : "offline"}
      </span>
      {ok && (
        <>
          <span>store: <b className="text-slate-200">{health.store_backend}</b></span>
          <span>embed: <b className="text-slate-200">{health.embedding_backend}</b></span>
          <span>claude: <b className="text-slate-200">{health.llm_available ? "live" : "stub"}</b></span>
        </>
      )}
    </div>
  );
}
