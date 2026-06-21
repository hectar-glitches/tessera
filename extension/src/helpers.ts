// Pure, side-effect-free helpers — unit tested without the vscode runtime.

export type Seniority = "junior" | "mid" | "senior" | "staff" | "principal";
export type Tenure = "onboarding" | "experienced";

export const SENIORITY_LEVEL: Record<Seniority, number> = {
  junior: 1,
  mid: 2,
  senior: 3,
  staff: 4,
  principal: 5,
};

export function levelForSeniority(seniority: string | undefined): number {
  if (!seniority) return 1;
  return SENIORITY_LEVEL[seniority as Seniority] ?? 1;
}

/** onboarding for the first 90 days since joinDate, else experienced. */
export function tenureForJoinDate(joinDate: string | undefined, now: Date = new Date()): Tenure {
  if (!joinDate) return "onboarding";
  const joined = new Date(joinDate);
  if (isNaN(joined.getTime())) return "onboarding";
  const days = (now.getTime() - joined.getTime()) / 86_400_000;
  return days < 90 ? "onboarding" : "experienced";
}

/** Best-effort extraction of the user's question text from a Claude Code hook payload. */
export function extractQuestion(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload.question,
    payload.prompt,
    payload.tool_input?.prompt,
    payload.tool_input?.question,
    payload.tool_input?.message,
    payload.input?.prompt,
    payload.message,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}
