import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceTools } from "../src/index.js";

async function folder(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "zhiyin-instructions-"));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const tools = new WorkspaceTools();
  await tools.selectWorkspace(root);
  return tools;
}

/** ADR 0054: a folder's AGENTS.md, read for the person to approve. */
describe("folder instructions", () => {
  it("reads AGENTS.md at the folder's root, with a hash of its content", async () => {
    const tools = await folder({ "AGENTS.md": "Invoices live in /finance." });

    const read = await tools.folderInstructions();

    expect(read).toMatchObject({
      path: "AGENTS.md",
      text: "Invoices live in /finance.",
      bytes: 26,
      truncated: false,
    });
    expect(read?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives a changed file a different hash", async () => {
    const first = await (
      await folder({ "AGENTS.md": "One." })
    ).folderInstructions();
    const second = await (
      await folder({ "AGENTS.md": "Two." })
    ).folderInstructions();

    expect(first?.hash).not.toBe(second?.hash);
  });

  it("cuts the text at 16 KB between characters and says so", async () => {
    const tools = await folder({ "AGENTS.md": `a${"é".repeat(10_000)}` });

    const read = await tools.folderInstructions();

    expect(read?.truncated).toBe(true);
    expect(read?.bytes).toBe(20_001);
    expect(Buffer.byteLength(read?.text ?? "")).toBeLessThanOrEqual(16_384);
    expect(read?.text).not.toContain("�");
  });

  it("finds nothing in a folder without one, in a subfolder, or with no folder", async () => {
    expect(await (await folder({})).folderInstructions()).toBeUndefined();
    expect(
      await (
        await folder({ "docs/AGENTS.md": "Nested." })
      ).folderInstructions(),
    ).toBeUndefined();
    expect(await new WorkspaceTools().folderInstructions()).toBeUndefined();
  });
});
