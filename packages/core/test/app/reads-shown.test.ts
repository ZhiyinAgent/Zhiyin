/**
 * A file counts as read only for what the model was shown of it: every page
 * a read hands the loop fits what the loop will show, so nothing credited as
 * read is cut away before the model sees it.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { FileRead } from "@zhiyin/contract";
import type { ModelRequest } from "@zhiyin/model-client";
import { WorkspaceTools, type ConversationItems } from "@zhiyin/tools";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import { loopFrom, stubDependencies } from "./support.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

/** What the conversation remembers having read, kept in memory. */
function rememberedReads(): ConversationItems {
  const reads = new Map<string, FileRead>();
  return {
    locate: async () => ({ status: "missing", reason: "Not stored." }),
    keepOutput: async () => ({ status: "refused", reason: "Not stored." }),
    lastRead: async (conversationId, path) =>
      reads.get(`${conversationId}/${path}`),
    noteRead: async (conversationId, path, read) => {
      reads.set(`${conversationId}/${path}`, read);
    },
  };
}

const report = (file: number) =>
  Array.from(
    { length: 350 },
    (_, line) => `file ${file} line ${line + 1} of the report`,
  ).join("\n");

describe("a file read in a round whose room runs out", () => {
  it("is shown whole or in a page that fits, and never written as though read whole", async () => {
    const root = await folders.make("zhiyin-reads-shown-");
    for (const file of [1, 2, 3, 4])
      await writeFile(join(root, `f${file}.txt`), report(file), "utf8");
    const workspace = new WorkspaceTools(root, {
      shell: undefined,
      items: rememberedReads(),
    });
    const requests: ModelRequest[] = [];
    const deps = stubDependencies(() => {});
    const agent = loopFrom({
      ...deps,
      permissions: {
        decide: async () => ({ outcome: "allow", reason: "Test policy." }),
      },
      tools: workspace,
      workspace,
      model: {
        ...deps.model,
        send: async function* (request: ModelRequest) {
          requests.push(request);
          if (requests.length === 1)
            for (const file of [1, 2, 3, 4])
              yield {
                kind: "toolCallDelta",
                index: file - 1,
                callId: `read-${file}`,
                name: "read_file",
                argumentsDelta: JSON.stringify({ path: `f${file}.txt` }),
              };
          else if (requests.length === 2)
            yield {
              kind: "toolCallDelta",
              index: 0,
              callId: "write-4",
              name: "write_file",
              argumentsDelta: JSON.stringify({
                path: "f4.txt",
                content: "Replaced.",
              }),
            };
          else yield { kind: "textDelta", text: "Done." };
          yield { kind: "done" };
        },
      },
    });
    await agent.selectWorkspace(root);
    const taskId = await agent.start(await agent.createTask(), "Tidy f4");
    void taskId;

    const answers = JSON.stringify(requests[1]?.messages);
    expect(answers).not.toContain("saved as output://");
    expect(answers).toContain("f4.txt");
    expect(await readFile(join(root, "f4.txt"), "utf8")).toBe(report(4));
  });
});
