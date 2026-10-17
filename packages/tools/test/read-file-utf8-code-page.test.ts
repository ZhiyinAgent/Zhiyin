import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceTools, type ToolResult } from "../src/index.js";

// A PC whose own code page is UTF-8, where it would show no character of a
// line that is not UTF-8.
vi.mock("@zhiyin/process-ownership", async (original) => ({
  ...(await original<typeof import("@zhiyin/process-ownership")>()),
  ansiCodePage: () => 65001,
  ansiText: () => "read in UTF-8",
}));

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

function textOf(result: ToolResult): string {
  if (!result.ok) throw new Error(result.reason);
  return (result.value as { text: string }).text;
}

describe("reading a file that is not all UTF-8 where Windows' code page is UTF-8", () => {
  it("shows the lines that are not UTF-8 as Windows-1252, and says so", async () => {
    const root = await folders.make("zhiyin-read-");
    await writeFile(
      join(root, "legacy.txt"),
      Buffer.concat([
        Buffer.from("plain\n", "latin1"),
        Buffer.from("café\n", "latin1"),
      ]),
    );

    const text = textOf(
      await new WorkspaceTools(root).execute("read_file", {
        path: "legacy.txt",
      }),
    );

    expect(text).toContain("2→café");
    expect(text).toContain("are shown as Windows-1252");
  });
});
