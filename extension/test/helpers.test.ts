import { describe, it, expect } from "vitest";
import { extractQuestion, levelForSeniority, tenureForJoinDate } from "../src/helpers";

describe("seniority -> level", () => {
  it("maps the tiers", () => {
    expect(levelForSeniority("junior")).toBe(1);
    expect(levelForSeniority("staff")).toBe(4);
    expect(levelForSeniority("principal")).toBe(5);
  });
  it("defaults unknown/empty to 1", () => {
    expect(levelForSeniority(undefined)).toBe(1);
    expect(levelForSeniority("wizard")).toBe(1);
  });
});

describe("tenure from join date", () => {
  const now = new Date("2026-06-21");
  it("onboarding within 90 days", () => {
    expect(tenureForJoinDate("2026-06-01", now)).toBe("onboarding");
  });
  it("experienced after 90 days", () => {
    expect(tenureForJoinDate("2025-01-01", now)).toBe("experienced");
  });
  it("missing/invalid date -> onboarding", () => {
    expect(tenureForJoinDate("", now)).toBe("onboarding");
    expect(tenureForJoinDate("not-a-date", now)).toBe("onboarding");
  });
});

describe("extractQuestion from hook payloads", () => {
  it("reads common shapes", () => {
    expect(extractQuestion({ prompt: "how do I run the dev server" })).toBe("how do I run the dev server");
    expect(extractQuestion({ tool_input: { question: " hi " } })).toBe("hi");
    expect(extractQuestion({})).toBeNull();
    expect(extractQuestion(null)).toBeNull();
  });
});
