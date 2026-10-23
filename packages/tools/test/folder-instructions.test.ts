import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { longestInstructionBytes } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceTools } from "../src/index.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

async function folder(files: Record<string, string>) {
  const root = await folders.make("zhiyin-instructions-");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return new WorkspaceTools(root);
}

/** ADR 0017: a folder's AGENTS.md, read for the person to approve. */
describe("folder instructions", () => {
  it("reads AGENTS.md at the folder's root, with a hash of its content", async () => {
    const tools = await folder({ "AGENTS.md": "Invoices live in /finance." });

    const read = await tools.folderInstructions(undefined);

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
    ).folderInstructions(undefined);
    const second = await (
      await folder({ "AGENTS.md": "Two." })
    ).folderInstructions(undefined);

    expect(first?.hash).not.toBe(second?.hash);
  });

  it("cuts the text past the most any budget sends, between characters, and says so", async () => {
    const tools = await folder({ "AGENTS.md": `a${"é".repeat(100_000)}` });

    const read = await tools.folderInstructions(undefined);

    expect(read?.truncated).toBe(true);
    expect(read?.bytes).toBe(200_001);
    expect(Buffer.byteLength(read?.text ?? "")).toBeLessThanOrEqual(
      longestInstructionBytes,
    );
    // As much as fits whole characters: two bytes each after the "a".
    expect(Buffer.byteLength(read?.text ?? "")).toBeGreaterThan(
      longestInstructionBytes - 2,
    );
    expect(read?.text).not.toContain("�");
  });

  it("hashes the whole file, past the part that is shown", async () => {
    const shown = "a".repeat(200_000);
    const first = await (
      await folder({ "AGENTS.md": `${shown}one` })
    ).folderInstructions(undefined);
    const second = await (
      await folder({ "AGENTS.md": `${shown}two` })
    ).folderInstructions(undefined);

    expect(first?.text).toBe(second?.text);
    expect(first?.hash).not.toBe(second?.hash);
  });

  it("finds nothing in a folder without one, in a subfolder, or with no folder", async () => {
    expect(
      await (await folder({})).folderInstructions(undefined),
    ).toBeUndefined();
    expect(
      await (
        await folder({ "docs/AGENTS.md": "Nested." })
      ).folderInstructions(undefined),
    ).toBeUndefined();
    expect(
      await new WorkspaceTools().folderInstructions(undefined),
    ).toBeUndefined();
  });

  it("finds nothing in an AGENTS.md that is a link leading out of the folder, and reads one leading to a file inside it", async () => {
    const outside = await folders.make("zhiyin-instructions-outside-");
    await writeFile(join(outside, "credentials"), "token=outside-secret");
    const root = await folders.make("zhiyin-instructions-");
    await symlink(
      join(outside, "credentials"),
      join(root, "AGENTS.md"),
      "file",
    );
    const inside = await folders.make("zhiyin-instructions-");
    await writeFile(join(inside, "notes.md"), "Invoices live in /finance.");
    await symlink(join(inside, "notes.md"), join(inside, "AGENTS.md"), "file");

    expect(
      await new WorkspaceTools(root).folderInstructions(undefined),
    ).toBeUndefined();
    expect(
      await new WorkspaceTools(inside).folderInstructions(undefined),
    ).toMatchObject({ text: "Invoices live in /finance." });
  });

  it("reads each conversation's own folder's file", async () => {
    const invoices = await folders.make("zhiyin-instructions-");
    const notes = await folders.make("zhiyin-instructions-");
    await writeFile(join(invoices, "AGENTS.md"), "Invoices live in /finance.");
    const tools = new WorkspaceTools();
    await tools.enterFolder("a", invoices);
    await tools.enterFolder("b", notes);

    expect((await tools.folderInstructions("a"))?.text).toBe(
      "Invoices live in /finance.",
    );
    expect(await tools.folderInstructions("b")).toBeUndefined();
  });
});
