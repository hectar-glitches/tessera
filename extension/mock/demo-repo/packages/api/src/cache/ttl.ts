// TTL constants (seconds) per entity type.
// Changing a value here invalidates nothing retroactively — Redis entries keep
// their original expiry. To force eviction, call cache.invalidate(tag).

export const TTL = {
  // User-specific data: short TTL — stale profile causes confusing UI.
  user: 60,
  userSession: 300,

  // Team/workspace data: medium TTL — changes are infrequent.
  team: 300,
  workspace: 300,
  workspaceMembers: 120,

  // Public/catalogue data: long TTL — expensive to recompute.
  plan: 3600,
  billingStatus: 120,

  // Never cache at the edge (Vercel) — always passes through to the API.
  // Set Cache-Control: no-store on these routes.
  neverCache: 0,
} as const;

export type CachableEntity = keyof typeof TTL;
