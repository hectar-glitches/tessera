import * as ld from "@launchdarkly/node-server-sdk";

// All feature flags are declared here with their default values.
// New flags: add to FlagKey + FLAGS_SCHEMA with JSDoc before using.
// Cleanup: remove within 2 weeks of 100% rollout — add to Linear "Flag Cleanup" project.

export type FlagKey =
  /** Enables the new workspace-level billing UI (replaces team billing). */
  | "workspace-billing-v2"
  /** Shows the AI assistant panel in the dashboard sidebar. */
  | "ai-assistant-panel"
  /** Enables streaming responses from the API (SSE). */
  | "streaming-responses"
  /** Gates multi-region failover routing at the edge. */
  | "multi-region-routing";

// Defaults are false for all new flags — safe off by default.
const FLAGS_SCHEMA: Record<FlagKey, boolean> = {
  "workspace-billing-v2": false,
  "ai-assistant-panel": false,
  "streaming-responses": false,
  "multi-region-routing": false,
};

let ldClient: ld.LDClient | undefined;

export async function initFlags() {
  ldClient = ld.init(process.env.LAUNCHDARKLY_SDK_KEY!);
  await ldClient.waitForInitialization();
}

// Server-side evaluation — always pass a userContext for targeting rules.
export async function getFlag(key: FlagKey, userContext: ld.LDContext): Promise<boolean> {
  if (!ldClient) return FLAGS_SCHEMA[key];
  return ldClient.variation(key, userContext, FLAGS_SCHEMA[key]);
}
