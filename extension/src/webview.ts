// HTML builders for the popup panel and the trending sidebar. Kept as plain strings
// (no separate webview bundler) — they post messages back to the extension host.
import { CheckResult, TrendingItem } from "./api";

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

const BASE_STYLE = `
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         padding: 0; margin: 0; }
  .card { background: var(--vscode-editorWidget-background);
          border: 1px solid var(--vscode-widget-border, #3334); border-radius: 10px;
          padding: 14px; margin: 10px; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .answer { font-family: var(--vscode-editor-font-family, monospace);
            background: var(--vscode-textCodeBlock-background); padding: 8px 10px;
            border-radius: 6px; margin: 8px 0; white-space: pre-wrap; }
  button { font-family: inherit; border: none; border-radius: 6px; padding: 6px 10px;
           cursor: pointer; font-size: 12px; }
  .primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .secondary { background: var(--vscode-button-secondaryBackground);
               color: var(--vscode-button-secondaryForeground); }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
`;

export function popupHtml(result: CheckResult, opts: { question: string; count?: number }): string {
  const pct = Math.round((result.similarity || 0) * 100);
  const peers =
    opts.count && opts.count > 0
      ? `<div class="muted">👥 ${opts.count} teammates at your level asked this recently</div>`
      : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_STYLE}</style></head>
  <body>
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <strong>⚡ OrgCache</strong>
        <span class="muted">${pct}% match</span>
      </div>
      <hr style="border-color: var(--vscode-widget-border,#3334)"/>
      <div class="muted">"${esc(opts.question)}"</div>
      <div class="answer">${esc(result.answer || "")}</div>
      ${peers}
      <div class="row" style="margin-top:12px">
        <button class="primary" onclick="send('use')">✓ Use This Answer</button>
        <button class="secondary" onclick="send('ask')">Ask Agent →</button>
        <button class="secondary" onclick="send('dismiss')">✕</button>
      </div>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      function send(action){ vscode.postMessage({ action }); }
    </script>
  </body></html>`;
}

export function sidebarHtml(items: TrendingItem[]): string {
  const cards =
    items.length === 0
      ? `<div class="muted" style="margin:12px">No trending questions for your segment yet.</div>`
      : items
          .map(
            (it, i) => `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <strong style="font-size:13px">${esc(it.question)}</strong>
          <span class="muted">${it.count}×</span>
        </div>
        <div class="answer" id="a${i}" style="display:none">${esc(it.answer)}</div>
        <div class="row" style="justify-content:space-between">
          <span class="muted">${esc(it.role)} · ${esc(it.seniority)}</span>
          <button class="secondary" onclick="toggle(${i})">Show answer</button>
        </div>
      </div>`,
          )
          .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_STYLE}</style></head>
  <body>
    <div class="row" style="justify-content:space-between;margin:10px">
      <strong>Trending FAQs</strong>
      <button class="secondary" onclick="refresh()">↻</button>
    </div>
    ${cards}
    <script>
      const vscode = acquireVsCodeApi();
      function toggle(i){ const el = document.getElementById('a'+i); el.style.display = el.style.display==='none'?'block':'none'; }
      function refresh(){ vscode.postMessage({ action: 'refresh' }); }
    </script>
  </body></html>`;
}
