import { describe, expect, it } from "vitest";
import { validateMermaid } from "./mermaidRuntime.js";

describe("Mermaid runtime", () => {
  it("accepts supported Mermaid source, naming its kind, and rejects malformed source", async () => {
    await expect(
      validateMermaid("flowchart LR\nDraft --> Review"),
    ).resolves.toBe("flowchart-v2");
    await expect(
      validateMermaid("flowchart LR\nDraft -- ???"),
    ).rejects.toBeInstanceOf(Error);
  });
});
