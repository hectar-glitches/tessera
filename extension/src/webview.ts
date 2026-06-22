import { CheckResult, TrendingItem } from "./api";

export type SidebarState =
  | { type: "trending" }
  | { type: "loading"; question: string }
  | { type: "hit"; result: CheckResult; opts: { question: string; count?: number } }
  | { type: "miss"; question: string };

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

const BRAND_ICON = `
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="6" height="6" rx="1.5"/>
    <rect x="9" y="1" width="6" height="6" rx="1.5"/>
    <rect x="1" y="9" width="6" height="6" rx="1.5"/>
    <rect x="9" y="9" width="6" height="6" rx="1.5"/>
  </svg>`;

const BASE_STYLE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: var(--vscode-foreground);
    background: transparent;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Sidebar shell ── */
  .sidebar { display: flex; flex-direction: column; min-height: 100vh; }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 10px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.12));
    position: sticky;
    top: 0;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    z-index: 1;
  }

  .sidebar-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--vscode-foreground);
    opacity: 0.85;
  }

  .refresh-btn {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    border-radius: 5px;
    padding: 3px 8px;
    font-size: 13px;
    cursor: pointer;
    transition: opacity 0.1s;
    line-height: 1;
    opacity: 0.45;
    outline: none;
    font-family: inherit;
  }
  .refresh-btn:hover { opacity: 0.85; }

  /* ── Search input ── */
  .search-section {
    display: flex;
    gap: 6px;
    padding: 10px 8px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.1));
  }

  .search-input {
    flex: 1;
    background: var(--vscode-input-background, rgba(128,128,128,0.1));
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.2));
    border-radius: 6px;
    color: var(--vscode-input-foreground, var(--vscode-foreground));
    font-family: inherit;
    font-size: 12px;
    padding: 6px 10px;
    outline: none;
    transition: border-color 0.12s;
  }
  .search-input::placeholder { opacity: 0.45; }
  .search-input:focus { border-color: var(--vscode-focusBorder, rgba(128,128,128,0.5)); }

  .search-btn {
    background: var(--vscode-foreground);
    color: var(--vscode-editor-background);
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    outline: none;
    transition: opacity 0.12s;
  }
  .search-btn:hover { opacity: 0.75; }
  .search-btn:active { opacity: 0.5; }
  .search-btn:disabled { opacity: 0.35; cursor: default; }

  /* ── Hit card ── */
  .hit-card {
    margin: 8px;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-focusBorder, rgba(128,128,128,0.3));
    border-radius: 10px;
    overflow: hidden;
  }

  .hit-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.12));
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 7px;
    font-weight: 600;
    font-size: 13px;
    letter-spacing: -0.02em;
    color: var(--vscode-foreground);
  }

  .match-badge {
    font-size: 11px;
    font-weight: 500;
    color: var(--vscode-foreground);
    background: rgba(128,128,128,0.15);
    border: 1px solid rgba(128,128,128,0.2);
    padding: 2px 8px;
    border-radius: 100px;
    opacity: 0.6;
  }

  .question-section { padding: 11px 14px 10px; }

  .section-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--vscode-descriptionForeground);
    opacity: 0.65;
    margin-bottom: 5px;
  }

  .question-text {
    font-size: 13px;
    color: var(--vscode-foreground);
    opacity: 0.75;
    line-height: 1.45;
  }

  .answer-section { padding: 0 12px 12px; }

  .answer-block {
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.07));
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.1));
    border-radius: 8px;
    padding: 11px 12px;
  }

  .answer-text {
    font-family: var(--vscode-editor-font-family, 'SF Mono', 'Menlo', 'Monaco', 'Consolas', monospace);
    font-size: 12px;
    line-height: 1.65;
    color: var(--vscode-foreground);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .peers-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px 10px;
    font-size: 11.5px;
    color: var(--vscode-descriptionForeground);
  }

  .peers-dot {
    width: 6px; height: 6px;
    background: #22c55e;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 0 2px rgba(34,197,94,0.2);
  }

  .action-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px 12px;
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.1));
  }

  button {
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
    letter-spacing: -0.01em;
    transition: opacity 0.12s ease;
    white-space: nowrap;
    outline: none;
  }
  button:hover { opacity: 0.75; }
  button:active { opacity: 0.5; }

  .btn-primary { background: var(--vscode-foreground); color: var(--vscode-editor-background); flex: 1; }
  .btn-secondary {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
    flex: 1;
    opacity: 0.65;
  }
  .btn-secondary:hover { opacity: 0.9; }
  .btn-icon {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    padding: 5px 9px;
    font-size: 12px;
    line-height: 1;
    opacity: 0.45;
  }
  .btn-icon:hover { opacity: 0.8; }

  /* ── Loading / Miss states ── */
  .status-card {
    margin: 8px;
    padding: 20px 16px;
    background: var(--vscode-editorWidget-background, rgba(128,128,128,0.05));
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.12));
    border-radius: 10px;
    text-align: center;
  }

  .status-label {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.7;
    line-height: 1.5;
  }

  .status-question {
    font-size: 12px;
    font-weight: 500;
    color: var(--vscode-foreground);
    opacity: 0.6;
    margin-top: 6px;
    font-style: italic;
  }

  .spinner {
    display: inline-block;
    width: 16px; height: 16px;
    border: 2px solid rgba(128,128,128,0.2);
    border-top-color: var(--vscode-foreground);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin-bottom: 8px;
    opacity: 0.6;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Trending list ── */
  .trending-list { padding: 8px 8px 16px; display: flex; flex-direction: column; gap: 6px; }

  .trend-card {
    background: var(--vscode-editorWidget-background, rgba(128,128,128,0.05));
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.12));
    border-radius: 9px;
    overflow: hidden;
    transition: border-color 0.15s;
  }
  .trend-card:hover { border-color: var(--vscode-focusBorder, rgba(128,128,128,0.3)); }

  .trend-card-top { padding: 10px 12px 8px; }

  .trend-question {
    font-size: 12.5px;
    font-weight: 500;
    line-height: 1.4;
    color: var(--vscode-foreground);
    margin-bottom: 7px;
    letter-spacing: -0.01em;
  }

  .trend-meta { display: flex; align-items: center; justify-content: space-between; }

  .tag-row { display: flex; gap: 4px; flex-wrap: wrap; }

  .tag {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.02em;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(128,128,128,0.15);
    border: 1px solid rgba(128,128,128,0.2);
    color: var(--vscode-foreground);
    opacity: 0.6;
    text-transform: capitalize;
  }

  .count-badge {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    opacity: 0.6;
    letter-spacing: -0.01em;
  }

  .toggle-btn {
    width: 100%;
    background: transparent;
    color: var(--vscode-foreground);
    border: none;
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.1));
    border-radius: 0;
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.01em;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    opacity: 0.4;
    transition: opacity 0.1s;
    outline: none;
  }
  .toggle-btn:hover { opacity: 0.85; }

  .toggle-chevron { font-size: 10px; transition: transform 0.15s; }

  .trend-answer {
    display: none;
    padding: 10px 12px;
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.08));
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.05));
  }

  .trend-answer-text {
    font-family: var(--vscode-editor-font-family, 'SF Mono', 'Menlo', 'Monaco', monospace);
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--vscode-foreground);
    opacity: 0.85;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    opacity: 0.5;
  }
  .empty-icon { margin-bottom: 10px; opacity: 0.4; }
  .empty-text { font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
`;

export function sidebarHtml(
  items: TrendingItem[],
  state: SidebarState = { type: "trending" },
  profile?: { role: string; seniority: string },
): string {
  // -- search input (always shown) --
  const searchSection = `
    <div class="search-section">
      <input class="search-input" id="q" type="text" placeholder="Ask a question…" />
      <button class="search-btn" id="ask-btn" onclick="ask()">Ask</button>
    </div>`;

  // -- content area based on state --
  let content = "";

  if (state.type === "loading") {
    content = `<div class="status-card">
      <div class="spinner"></div>
      <div class="status-label">Searching cache…</div>
      <div class="status-question">${esc(state.question)}</div>
    </div>`;
  } else if (state.type === "miss") {
    content = `<div class="status-card">
      <div class="status-label">No cached answer found.<br>Ask your coding agent.</div>
      <div class="status-question">${esc(state.question)}</div>
    </div>`;
  } else if (state.type === "hit") {
    const { result, opts } = state;
    const pct = Math.round((result.similarity || 0) * 100);
    const peers = opts.count && opts.count > 0
      ? `<div class="peers-row">
          <span class="peers-dot"></span>
          <span>${opts.count} teammate${opts.count === 1 ? "" : "s"} at your level asked this recently</span>
         </div>`
      : "";
    content = `<div class="hit-card">
      <div class="hit-header">
        <div class="brand">${BRAND_ICON} Cache hit</div>
        <span class="match-badge">${pct}% match</span>
      </div>
      <div class="question-section">
        <div class="section-label">Query</div>
        <div class="question-text">${esc(opts.question)}</div>
      </div>
      <div class="answer-section">
        <div class="section-label" style="padding-bottom:6px">Cached answer</div>
        <div class="answer-block"><div class="answer-text">${esc(result.answer || "")}</div></div>
      </div>
      ${peers}
      <div class="action-bar">
        <button class="btn-primary" onclick="send('use')">Use Answer</button>
        <button class="btn-secondary" onclick="send('ask')">Ask Agent →</button>
        <button class="btn-icon" onclick="send('dismiss')" title="Dismiss">✕</button>
      </div>
    </div>`;
  } else {
    // trending
    content = items.length === 0
      ? `<div class="empty-state">
          <div class="empty-icon">${BRAND_ICON}</div>
          <div class="empty-text">No trending questions<br>for your segment yet.</div>
         </div>`
      : `<div class="trending-list">${items.map((it, i) => `
        <div class="trend-card">
          <div class="trend-card-top">
            <div class="trend-question">${esc(it.question)}</div>
            <div class="trend-meta">
              <div class="tag-row">
                <span class="tag">${esc(it.role)}</span>
                <span class="tag">${esc(it.seniority)}</span>
              </div>
              <span class="count-badge">${it.count}×</span>
            </div>
          </div>
          <button class="toggle-btn" onclick="toggle(${i})" id="btn${i}">
            <span>Show answer</span>
            <span class="toggle-chevron" id="chev${i}">›</span>
          </button>
          <div class="trend-answer" id="a${i}">
            <div class="trend-answer-text">${esc(it.answer)}</div>
          </div>
        </div>`).join("")}
      </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${BASE_STYLE}</style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-title">${BRAND_ICON} Tessera</div>
      <div style="display:flex;align-items:center;gap:5px">
        ${profile ? `<button class="refresh-btn" onclick="setProfile()" title="Change role / seniority" style="font-size:11px;letter-spacing:0.01em;padding:3px 7px">${esc(profile.role)} · ${esc(profile.seniority)}</button>` : ""}
        <button class="refresh-btn" onclick="refresh()" title="Refresh">↻</button>
      </div>
    </div>
    ${searchSection}
    ${content}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const open = new Set();

    function ask() {
      const text = document.getElementById('q').value.trim();
      if (!text) return;
      document.getElementById('ask-btn').disabled = true;
      vscode.postMessage({ action: 'query', text });
    }

    document.getElementById('q').addEventListener('keydown', e => {
      if (e.key === 'Enter') ask();
    });

    function send(action) { vscode.postMessage({ action }); }

    function setProfile() { vscode.postMessage({ action: 'setProfile' }); }

    function refresh() {
      document.getElementById('q').value = '';
      vscode.postMessage({ action: 'refresh' });
    }

    function toggle(i) {
      const el = document.getElementById('a' + i);
      const btn = document.getElementById('btn' + i);
      const chev = document.getElementById('chev' + i);
      if (open.has(i)) {
        open.delete(i);
        el.style.display = 'none';
        btn.querySelector('span').textContent = 'Show answer';
        chev.style.transform = '';
      } else {
        open.add(i);
        el.style.display = 'block';
        btn.querySelector('span').textContent = 'Hide answer';
        chev.style.transform = 'rotate(90deg)';
      }
    }
  </script>
</body>
</html>`;
}
