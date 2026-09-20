import { describe, expect, it, vi } from "vitest";
import { validateView } from "./viewValidation.js";

vi.mock("./mermaidRuntime.js", () => ({
  validateMermaid: async (source: string) => {
    if (source.includes("???")) throw new Error("Parse error");
  },
}));

describe("validateView", () => {
  it("reports the drawing library complaint for an invalid diagram", async () => {
    await expect(
      validateView({ id: "1", kind: "diagram", source: "flowchart ???" }),
    ).resolves.toEqual({ ok: false, reason: "Parse error" });
  });

  it("rejects malformed persisted chart source", async () => {
    await expect(
      validateView({ id: "2", kind: "bar-chart", source: "{" }),
    ).resolves.toMatchObject({ ok: false });
  });
});
