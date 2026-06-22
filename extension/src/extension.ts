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
    vscode.commands.registerCommand("tessera.setProfile", () => setProfileCommand()),
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
  const port = cfg.get<number>("hookPort", 7778);
  const holdTimeoutMs = cfg.get<number>("hookHoldTimeoutMs", 600000);

  hookServer = http.createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let payload: any = {};
      try { payload = body ? JSON.parse(body) : {}; } catch { /* ignore */ }
      const question = extractQuestion(payload);

      let answered = false;
      const respond = (obj: any) => {
        if (answered) return;
        answered = true;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      // Let Claude Code continue running. "allow" auto-approves the tool call so
      // the agent proceeds without re-prompting for permission.
      const cont = () =>
        respond({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason: "Tessera: continue",
          },
        });
      // Pause/stop the agent — Claude Code receives the cached answer as the reason.
      const block = (reason: string) =>
        respond({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason,
          },
        });

      if (!question) { cont(); return; }
      log(`hook question: ${question}`);

      const result = await queryCache(question);
      if (!result) {
        // Cache miss — nothing to pause for, let the agent run.
        cont();
        return;
      }

      // Cache hit — hold the response open so Claude Code pauses while the user
      // reviews the cached answer in the sidebar. The sidebar action decides:
      //   "ask"           -> cont()    (Ask anyways: continue Claude Code)
      //   "use"/"dismiss" -> block(...)(keep paused; user took the cached answer)
      const answer = result.checkResult.answer || "";
      const decide = (continueAgent: boolean) => {
        if (continueAgent) {
          log("hook decision: continue agent (ask anyways)");
          cont();
        } else {
          log("hook decision: pause agent (used cached answer)");
          block(`Tessera cache hit — answered from the org knowledge cache:\n\n${answer}`);
        }
      };

      // Safety net: if the user never responds, release the connection so the
      // socket and the agent don't hang forever.
      const timer = setTimeout(() => {
        if (!answered) { log("hook hold timed out — continuing agent"); cont(); }
      }, holdTimeoutMs);
      res.on("close", () => clearTimeout(timer));

      trendingProvider?.showHookHit(result.checkResult, { question, count: result.count }, decide);
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

async function setProfileCommand() {
  const ROLES = ["engineer", "designer", "pm", "devops", "manager"];
  const LEVELS = ["junior", "mid", "senior", "staff", "principal"];
  const cfg = vscode.workspace.getConfiguration("tessera");
  const currentRole = cfg.get<string>("role", "engineer");
  const currentSeniority = cfg.get<string>("seniority", "junior");

  const role = await vscode.window.showQuickPick(
    ROLES.map(r => ({ label: r, description: r === currentRole ? "current" : "" })),
    { title: "Tessera: Select your role", placeHolder: currentRole },
  );
  if (!role) return;

  const seniority = await vscode.window.showQuickPick(
    LEVELS.map(s => ({ label: s, description: s === currentSeniority ? "current" : "" })),
    { title: "Tessera: Select your seniority", placeHolder: currentSeniority },
  );
  if (!seniority) return;

  await cfg.update("role", role.label, vscode.ConfigurationTarget.Global);
  await cfg.update("seniority", seniority.label, vscode.ConfigurationTarget.Global);
  log(`profile updated: role=${role.label} seniority=${seniority.label}`);
  vscode.window.showInformationMessage(`Tessera: profile set to ${role.label} / ${seniority.label}`);
  trendingProvider?.refresh();
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
  // Resolver for an in-flight Claude Code hook request that is currently paused
  // waiting on the user's decision. (true = continue agent, false = stay paused)
  private pendingHookDecision?: (continueAgent: boolean) => void;

  private resolveHook(continueAgent: boolean) {
    const decide = this.pendingHookDecision;
    this.pendingHookDecision = undefined;
    decide?.(continueAgent);
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage(async (m) => {
      if (m.action === "setProfile") {
        await setProfileCommand();
      } else if (m.action === "refresh") {
        this.state = { type: "trending" };
        this.refresh();
      } else if (m.action === "query") {
        await this.query(m.text);
      } else if (m.action === "use") {
        if (this.state.type === "hit") {
          await vscode.env.clipboard.writeText(this.state.result.answer || "");
          vscode.window.showInformationMessage("Tessera: answer copied to clipboard.");
        }
        // Keep Claude Code paused — the user took the cached answer.
        this.resolveHook(false);
        this.state = { type: "trending" };
        this.render();
      } else if (m.action === "ask" || m.action === "dismiss") {
        if (m.action === "ask") log("user chose Ask Agent");
        // "ask" = ask anyways -> continue the agent. "dismiss" = stay paused.
        this.resolveHook(m.action === "ask");
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

  // Cache hit originating from a Claude Code hook: show the answer AND keep a
  // handle to the paused agent request so the sidebar buttons can resolve it.
  showHookHit(
    result: CheckResult,
    opts: { question: string; count?: number },
    decide: (continueAgent: boolean) => void,
  ) {
    // Resolve any stale pending request (continue it) before taking over.
    this.resolveHook(true);
    this.pendingHookDecision = decide;
    this.showHit(result, opts);
  }

  async refresh() {
    const ctx = readContext();
    this.cachedItems = await getTrending(ctx, log);
    if (this.state.type === "trending") this.render();
  }

  private render() {
    if (!this.view) return;
    const ctx = readContext();
    this.view.webview.html = sidebarHtml(this.cachedItems, this.state, { role: ctx.role, seniority: ctx.seniority });
  }
}
