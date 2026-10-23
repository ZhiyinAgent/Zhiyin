import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { WorkspaceTools } from "../src/index.js";

/** Every file the tools load whole, by path. */
const loaded = vi.hoisted(() => [] as string[]);

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: ((path: Parameters<typeof actual.readFile>[0], ...rest: []) => {
      loaded.push(String(path));
      return actual.readFile(path, ...rest);
    }) as typeof actual.readFile,
  };
});

const folders = new TemporaryFolders();

afterEach(async () => {
  loaded.length = 0;
  await folders.removeAll();
});

describe("a file the model has not read", () => {
  it("is refused for replacing before any of it is loaded", async () => {
    const root = await folders.make("zhiyin-unread-");
    await writeFile(join(root, "draft.txt"), "x".repeat(1_000_000));
    const tools = new WorkspaceTools(root, {
      items: {
        locate: async () => ({ status: "missing", reason: "Not stored." }),
        keepOutput: async () => ({ status: "refused", reason: "Not stored." }),
        lastRead: async () => undefined,
        noteRead: async () => {},
      },
    });

    const refused = await tools.inspect(
      "write_file",
      { path: "draft.txt", content: "Assistant's draft." },
      "conversation-1",
    );

    expect(refused).toMatchObject({ ok: false, correctable: true });
    expect(loaded.filter((path) => path.endsWith("draft.txt"))).toEqual([]);
  });
});
