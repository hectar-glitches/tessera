import * as http from "node:http";
import * as vscode from "vscode";

import { CheckResult, UserContext, checkCache, getTrending } from "./api";
import { extractQuestion, levelForSeniority, tenureForJoinDate } from "./helpers";
import { popupHtml, sidebarHtml } from "./webview";

let output: vscode.OutputChannel;
let hookServer: http.Server | undefined;
let trendingProvider: TrendingProvider | undefined;

function log(msg: string) {
  output?.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

function readContext(): UserContext {
  const cfg = vscode.workspace.getConfiguration("orgcache");
  return {
    serverUrl: cfg.get<string>("serverUrl", "http://localhost:8000"),
    org: cfg.get<string>("org", "acmecorp"),
    role: cfg.get<string>("role", "engineer"),
    seniority: cfg.get<string>("seniority", "junior"),
    tenure: tenureForJoinDate(cfg.get<string>("joinDate", "")),
  };
}

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("OrgCache");
  context.subscriptions.push(output);
  log("OrgCache activated");

  const ctx = readContext();
  log(`context: org=${ctx.org} role=${ctx.role} seniority=${ctx.seniority} ` +
      `(level ${levelForSeniority(ctx.seniority)}) tenure=${ctx.tenure}`);

  // Trending sidebar.
  trendingProvider = new TrendingProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("orgcache.trending", trendingProvider),
  );

  // Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("orgcache.checkSelection", () => checkSelectionCommand()),
    vscode.commands.registerCommand("orgcache.openTrending", () => trendingProvider?.refresh()),
  );

  // Claude Code PreToolUse hook listener.
  startHookListener(context);

  // Refresh trending every 5 minutes.
  const timer = setInterval(() => trendingProvider?.refresh(), 5 * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate() {
  hookServer?.close();
}

// ----------------------------------------------------------------- hook listener
function startHookListener(context: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration("orgcache");
  const port = cfg.get<number>("hookPort", 7777);

  hookServer = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let payload: any = {};
      try { payload = body ? JSON.parse(body) : {}; } catch { /* ignore */ }
      const question = extractQuestion(payload);
      const respond = (obj: any) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (!question) {
        respond({ decision: "continue" });
        return;
      }
      log(`hook question: ${question}`);
      const result = await handleQuestion(question);
      // Tell Claude Code to continue (we never block; the popup is advisory).
      respond({ decision: "continue", orgcache: { hit: result?.decision === "hit" } });
    });
  });

  hookServer.on("error", (e: any) => log(`hook listener error: ${e?.message || e}`));
  hookServer.listen(port, "127.0.0.1", () => log(`hook listener on 127.0.0.1:${port}`));
  context.subscriptions.push({ dispose: () => hookServer?.close() });
}

// --------------------------------------------------------------- core behaviors
async function handleQuestion(question: string): Promise<CheckResult | null> {
  const ctx = readContext();
  const cfg = vscode.workspace.getConfiguration("orgcache");
  const threshold = cfg.get<number>("similarityThreshold", 0.85);

  const result = await checkCache(ctx, question, log);
  if (!result) return null;
  if (result.decision === "hit" && result.similarity >= threshold) {
    let count = 0;
    const trending = await getTrending(ctx, log);
    const match = trending.find((t) => t.question === result.matched_question);
    if (match) count = match.count;
    showPopup(result, { question, count });
  }
  return result;
}

async function checkSelectionCommand() {
  const editor = vscode.window.activeTextEditor;
  let text = editor?.document.getText(editor.selection)?.trim();
  if (!text) {
    text = await vscode.window.showInputBox({ prompt: "Ask OrgCache" });
  }
  if (!text) return;
  const result = await handleQuestion(text);
  if (!result || result.decision !== "hit") {
    vscode.window.showInformationMessage("OrgCache: no confident cached answer — ask your agent.");
  }
}

let popupPanel: vscode.WebviewPanel | undefined;

function showPopup(result: CheckResult, opts: { question: string; count?: number }) {
  if (!popupPanel) {
    popupPanel = vscode.window.createWebviewPanel(
      "orgcache.popup",
      "⚡ OrgCache",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    popupPanel.onDidDispose(() => (popupPanel = undefined));
  }
  popupPanel.webview.html = popupHtml(result, opts);
  popupPanel.reveal(vscode.ViewColumn.Beside, true);

  const sub = popupPanel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.action === "use") {
      await vscode.env.clipboard.writeText(result.answer || "");
      vscode.window.showInformationMessage("OrgCache: answer copied to clipboard.");
      popupPanel?.dispose();
    } else if (msg.action === "ask") {
      log("user chose Ask Agent — forwarding to coding agent");
      popupPanel?.dispose();
    } else if (msg.action === "dismiss") {
      log("user dismissed popup (negative signal)");
      popupPanel?.dispose();
    }
  });
  if (popupPanel) popupPanel.onDidDispose(() => sub.dispose());
}

// --------------------------------------------------------------- trending view
class TrendingProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((m) => {
      if (m.action === "refresh") this.refresh();
    });
    this.refresh();
  }

  async refresh() {
    if (!this.view) return;
    const ctx = readContext();
    const items = await getTrending(ctx, log);
    this.view.webview.html = sidebarHtml(items);
  }
}
