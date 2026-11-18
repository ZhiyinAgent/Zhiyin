/**
 * Each conversation's own folder of CAD studio records, handed out and let go
 * of with the conversation.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { CadConversations } from "../src/index.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

describe("a conversation's CAD studio records", () => {
  it("are removed when the conversation is forgotten, and another conversation's are kept", async () => {
    const data = await folders.make("zhiyin-cad-data-");
    const conversations = new CadConversations(join(data, "cad-studio"));
    const gone = conversations.folder("conversation-1");
    const kept = conversations.folder("conversation-2");
    for (const folder of [gone, kept]) {
      await mkdir(join(folder, "runs", "held"), { recursive: true });
      await writeFile(join(folder, "drawings.json"), "{}");
    }

    await conversations.forget("conversation-1");

    expect(await readdir(join(data, "cad-studio"))).toEqual(["conversation-2"]);
    expect(await readFile(join(kept, "drawings.json"), "utf8")).toBe("{}");
  });

  it("leave the files the conversation's builds wrote to the workspace, which is the person's", async () => {
    const data = await folders.make("zhiyin-cad-data-");
    const workspace = await folders.make("zhiyin-cad-workspace-");
    const conversations = new CadConversations(join(data, "cad-studio"));
    await mkdir(conversations.folder("conversation-1"), { recursive: true });
    await writeFile(join(workspace, "plate.step"), "step of the part");

    await conversations.forget("conversation-1");

    expect(await readFile(join(workspace, "plate.step"), "utf8")).toBe(
      "step of the part",
    );
  });

  it("forgets a conversation that kept nothing without failing", async () => {
    const data = await folders.make("zhiyin-cad-data-");
    const conversations = new CadConversations(join(data, "cad-studio"));

    await expect(conversations.forget("never-built")).resolves.toBeUndefined();
  });
});
