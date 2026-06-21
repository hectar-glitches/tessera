import { describe, it, expect } from "vitest";
import { mockApi } from "./mockData.js";

describe("OrgCache mock data layer (drives the dashboard filter bar)", () => {
  it("trending respects the seniority hierarchy", () => {
    const junior = mockApi("acmecorp", "trending", { role: "engineer", seniority: "junior" });
    // A junior must never see a staff/principal-level entry.
    expect(junior.items.every((i) => ["junior"].includes(i.seniority))).toBe(true);
    expect(junior.items.length).toBeGreaterThan(0);

    const principal = mockApi("acmecorp", "trending", { role: "engineer", seniority: "principal" });
    const seniorities = new Set(principal.items.map((i) => i.seniority));
    expect(seniorities.has("staff") || seniorities.has("principal")).toBe(true);
  });

  it("trending is ordered by hit count descending", () => {
    const { items } = mockApi("acmecorp", "trending", { seniority: "principal" });
    const counts = items.map((i) => i.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("entries filter by role", () => {
    const { entries } = mockApi("acmecorp", "entries", { role: "devops", seniority: "principal" });
    expect(entries.every((e) => e.role === "devops")).toBe(true);
  });
});
