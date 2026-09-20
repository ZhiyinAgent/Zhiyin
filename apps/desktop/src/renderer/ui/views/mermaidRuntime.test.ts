import { describe, expect, it } from "vitest";
import { validateMermaid } from "./mermaidRuntime.js";

describe("Mermaid runtime", () => {
  it("accepts supported Mermaid source and rejects malformed source", async () => {
    await expect(
      validateMermaid("flowchart LR\nDraft --> Review"),
    ).resolves.toBeUndefined();
    await expect(
      validateMermaid("flowchart LR\nDraft -- ???"),
    ).rejects.toBeInstanceOf(Error);
  });
});
