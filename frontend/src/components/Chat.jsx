import { useEffect, useRef, useState } from "react";
import { Send, Zap, Sparkles, HelpCircle, ArrowRight } from "lucide-react";
import { api } from "../api.js";

const STARTERS = [
  "What time is Saturday lunch?",
  "What is the prize for Ddoski's Toolbox?",
  "How big can my team be?",
  "Who are the sponsors?",
];

export default function Chat() {
  const [messages, setMessages] = useState([
    {
      role: "bot",
      text: "Hi! I'm Ddoski. Ask me anything about AI Hackathon 2026 — tracks, prizes, meals, schedule, or rules.",
      meta: null,
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(null); // { question, suggestions }
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending, loading]);

  async function ask(question, { accept_hash = null, force_generate = false } = {}) {
    if (!question.trim()) return;
    setPending(null);
    if (!accept_hash) {
      setMessages((m) => [...m, { role: "user", text: question }]);
    }
    setLoading(true);
    try {
      const r = await api.query(question, accept_hash, force_generate);
      if (r.decision === "suggest" && !force_generate) {
        setPending({ question, suggestions: r.suggestions });
      } else {
        setMessages((m) => [...m, { role: "bot", text: r.answer, meta: r }]);
      }
    } catch (e) {
      setMessages((m) => [...m, { role: "bot", text: `Error: ${e.message}`, meta: null }]);
    } finally {
      setLoading(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    const q = input;
    setInput("");
    ask(q);
  }

  return (
    <div className="grid md:grid-cols-[1fr] gap-4">
      <div className="bg-panel border border-edge rounded-2xl flex flex-col h-[72vh]">
        <div className="px-5 py-3 border-b border-edge flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-400" />
          <span className="font-medium">Ask Ddoski</span>
          <span className="text-xs text-slate-500 ml-auto">cached answers are served instantly &amp; free</span>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-4">
          {messages.map((m, i) => (
            <Bubble key={i} m={m} />
          ))}

          {pending && (
            <SuggestionCard
              pending={pending}
              onPick={(h) => ask(pending.question, { accept_hash: h })}
              onFresh={() => ask(pending.question, { force_generate: true })}
            />
          )}

          {loading && (
            <div className="text-slate-400 text-sm flex items-center gap-2">
              <span className="animate-pulse">Ddoski is thinking…</span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="px-5 py-3 border-t border-edge">
          <div className="flex flex-wrap gap-2 mb-3">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="text-xs px-2.5 py-1 rounded-full border border-edge text-slate-300 hover:bg-ink"
              >
                {s}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              className="flex-1 bg-ink border border-edge rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl px-4 flex items-center gap-2 text-sm font-medium"
            >
              <Send size={16} /> Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Bubble({ m }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser ? "bg-indigo-600 text-white" : "bg-ink border border-edge"
        }`}
      >
        {!isUser && m.meta && <DecisionTag meta={m.meta} />}
        <div className="whitespace-pre-wrap">{m.text}</div>
      </div>
    </div>
  );
}

function DecisionTag({ meta }) {
  if (meta.decision === "hit") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 mb-1 font-medium">
        <Zap size={12} className="fill-emerald-400" /> instant
        <span className="text-slate-500 font-normal">· saved ${meta.dollars_saved.toFixed(5)}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-1">
      {meta.via === "claude" ? "generated" : "generated (stub)"}
    </div>
  );
}

function SuggestionCard({ pending, onPick, onFresh }) {
  return (
    <div className="bg-ink border border-amber-500/40 rounded-2xl p-4 max-w-[90%]">
      <div className="flex items-center gap-2 text-amber-300 text-sm font-medium mb-1">
        <HelpCircle size={16} /> Did you mean one of these?
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Your question is close to ones already answered — but close enough to be risky.
        Pick the exact match to get an instant answer, or ask fresh.
      </p>
      <div className="space-y-2">
        {pending.suggestions.map((s) => (
          <button
            key={s.hash}
            onClick={() => onPick(s.hash)}
            className="w-full text-left group flex items-center gap-2 bg-panel border border-edge hover:border-indigo-500 rounded-xl px-3 py-2 text-sm"
          >
            <ArrowRight size={14} className="text-indigo-400 shrink-0" />
            <span className="flex-1">{s.question}</span>
            <span className="text-[10px] text-slate-500">sim {s.similarity.toFixed(2)}</span>
            {s.entity_conflict && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300">
                differs: {s.conflict_categories.join(", ")}
              </span>
            )}
          </button>
        ))}
      </div>
      <button
        onClick={onFresh}
        className="mt-3 text-xs text-slate-300 underline underline-offset-2 hover:text-white"
      >
        None of these — answer my question fresh
      </button>
    </div>
  );
}
