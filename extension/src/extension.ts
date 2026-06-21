import * as http from "node:http";
import * as vscode from "vscode";

import { CheckResult, TrendingItem, UserContext, checkCache, getTrending } from "./api";
import { extractQuestion, levelForSeniority, tenureForJoinDate } from "./helpers";
import { SidebarState, sidebarHtml } from "./webview";

let output: vscode.OutputChannel;
let hookServer: http.Server | undefined;
let trendingProvider: TrendingProvider | undefined;

function log(msg: string) {
  output?.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

function readContext(): UserContext {
  const cfg = vscode.workspace.getConfiguration("tessera");
  return {
    serverUrl: cfg.get<string>("serverUrl", "http://localhost:8000"),
    org: cfg.get<string>("org", "acmecorp"),
    role: cfg.get<string>("role", "engineer"),
    seniority: cfg.get<string>("seniority", "junior"),
    tenure: tenureForJoinDate(cfg.get<string>("joinDate", "")),
  };
}

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("Tessera");
  context.subscriptions.push(output);
  log("Tessera activated");

  const ctx = readContext();
  log(`context: org=${ctx.org} role=${ctx.role} seniority=${ctx.seniority} ` +
      `(level ${levelForSeniority(ctx.seniority)}) tenure=${ctx.tenure}`);

  trendingProvider = new TrendingProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("tessera.trending", trendingProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  vscode.commands.executeCommand("tessera.trending.focus");

  context.subscriptions.push(
    vscode.commands.registerCommand("tessera.checkSelection", () => checkSelectionCommand()),
    vscode.commands.registerCommand("tessera.openTrending", () => trendingProvider?.refresh()),
  );

  startHookListener(context);

  const timer = setInterval(() => trendingProvider?.refresh(), 5 * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate() {
  hookServer?.close();
}

// ----------------------------------------------------------------- hook listener
function startHookListener(context: vscode.ExtensionContext) {
  const cfg = vscode.workspace.getConfiguration("tessera");
  const port = cfg.get<number>("hookPort", 7777);

  hookServer = http.createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
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
      if (!question) { respond({ decision: "continue" }); return; }
      log(`hook question: ${question}`);
      const result = await queryCache(question);
      if (result) trendingProvider?.showHit(result.checkResult, { question, count: result.count });
      respond({ decision: "continue", tessera: { hit: !!result } });
    });
  });

  hookServer.on("error", (e: any) => log(`hook listener error: ${e?.message || e}`));
  hookServer.listen(port, "127.0.0.1", () => log(`hook listener on 127.0.0.1:${port}`));
  context.subscriptions.push({ dispose: () => hookServer?.close() });
}

// --------------------------------------------------------------- core query
async function queryCache(question: string): Promise<{ checkResult: CheckResult; count: number } | null> {
  const ctx = readContext();
  const cfg = vscode.workspace.getConfiguration("tessera");
  const threshold = cfg.get<number>("similarityThreshold", 0.85);

  const result = await checkCache(ctx, question, log);
  if (!result || result.decision !== "hit" || result.similarity < threshold) return null;

  let count = 0;
  const trending = await getTrending(ctx, log);
  const match = trending.find((t) => t.question === result.matched_question);
  if (match) count = match.count;
  return { checkResult: result, count };
}

async function checkSelectionCommand() {
  const editor = vscode.window.activeTextEditor;
  let text = editor?.document.getText(editor.selection)?.trim();
  if (!text) text = await vscode.window.showInputBox({ prompt: "Ask Tessera" });
  if (!text) return;
  await trendingProvider?.query(text);
}

// --------------------------------------------------------------- sidebar view

class TrendingProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private cachedItems: TrendingItem[] = [];
  private state: SidebarState = { type: "trending" };

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage(async (m) => {
      if (m.action === "refresh") {
        this.state = { type: "trending" };
        this.refresh();
      } else if (m.action === "query") {
        await this.query(m.text);
      } else if (m.action === "use") {
        if (this.state.type === "hit") {
          await vscode.env.clipboard.writeText(this.state.result.answer || "");
          vscode.window.showInformationMessage("Tessera: answer copied to clipboard.");
        }
        this.state = { type: "trending" };
        this.render();
      } else if (m.action === "ask" || m.action === "dismiss") {
        if (m.action === "ask") log("user chose Ask Agent");
        this.state = { type: "trending" };
        this.render();
      }
    });
    this.refresh();
  }

  async query(question: string) {
    this.state = { type: "loading", question };
    this.render();
    const hit = await queryCache(question);
    if (hit) {
      this.state = { type: "hit", result: hit.checkResult, opts: { question, count: hit.count } };
    } else {
      this.state = { type: "miss", question };
    }
    this.render();
  }

  showHit(result: CheckResult, opts: { question: string; count?: number }) {
    this.state = { type: "hit", result, opts };
    vscode.commands.executeCommand("tessera.trending.focus");
    this.render();
  }

  async refresh() {
    const ctx = readContext();
    this.cachedItems = await getTrending(ctx, log);
    if (this.state.type === "trending") this.render();
  }

  private render() {
    if (!this.view) return;
    this.view.webview.html = sidebarHtml(this.cachedItems, this.state);
  }
}
