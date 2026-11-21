/**
 * Going back over a sealed-off command, on a real app container (ADR 0029):
 * the files it changed in the workspace are put back as they were before its
 * turn, and the ones it made are removed.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { ModelRequest } from "@zhiyin/model-client";
import { FileRecovery } from "@zhiyin/recovery";
import { ConversationRewind } from "@zhiyin/rewind-planner";
import { forgetConfinement, openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { WorkspaceTools } from "@zhiyin/tools";
import { loopFrom, stubDependencies } from "../test/app/support.js";

/** Zhiyin's shell as the gate builds it. */
const built = process.env["ZHIYIN_BUSYBOX"] ?? "";
const folders = new TemporaryFolders();
const homes = new TemporaryFolders();
let homesFolder = "";

afterEach(() => folders.removeAll());
afterAll(async () => {
  for (const name of await readdir(homesFolder).catch(() => []))
    forgetConfinement("shell", join(homesFolder, name));
  await homes.removeAll();
});

describe.runIf(process.platform === "win32" && built !== "")(
  "going back over a sealed-off command",
  { timeout: 180_000 },
  () => {
    it("puts back the files it changed and removes the ones it made, leaving the rest as they were", async () => {
      homesFolder = await homes.make("zhiyin-going-back-homes-");
      const root = await folders.make("zhiyin-going-back-");
      const storage = await folders.make("zhiyin-going-back-recovery-");
      await writeFile(join(root, "table.csv"), "a,b\n1,2\n");
      await writeFile(join(root, "notes.txt"), "the person's notes");
      const workspace = new WorkspaceTools(root, {
        containment: { open: openProcessContainer },
        // Each command ends within its call, however slow a loaded machine
        // makes it, rather than becoming a job.
        promoteCommandsAfterMs: 150_000,
        sealedShell: {
          busybox: join(built, "busybox.exe"),
          handoff: join(built, "git"),
          homes: homesFolder,
        },
        reach: () => ({ hosts: [], read: [], change: [], registries: false }),
      });
      const command =
        "printf 'a,b\\n9,9\\n' > table.csv && echo made > made.txt && mkdir charts && echo chart > charts/chart.txt";
      const deps = stubDependencies(() => {});
      let request = 0;
      const agent = loopFrom({
        ...deps,
        permissions: {
          decide: async () => ({ outcome: "allow", reason: "Test policy." }),
        },
        tools: workspace,
        commands: workspace,
        workspace,
        recovery: new FileRecovery(storage, { list: workspace.listWorkspace }),
        rewind: new ConversationRewind(() => `going-back-${request}`),
        model: {
          ...deps.model,
          // The shell is called until its answer comes back.
          send: async function* (asked: ModelRequest) {
            request += 1;
            const answered = asked.messages.some(
              (message) => message.role === "tool" && message.name === "bash",
            );
            if (asked.tools?.length && !answered)
              yield {
                kind: "toolCallDelta",
                index: 0,
                callId: "command-1",
                name: "bash",
                argumentsDelta: JSON.stringify({
                  command,
                  purpose: "Clean the table.",
                }),
              };
            else yield { kind: "textDelta", text: "Done." };
            yield { kind: "done" };
          },
        },
      });
      await agent.selectWorkspace(root);
      const taskId = await agent.createTask();
      await agent.start(taskId, "Clean the table");
      const action = agent.snapshot().tasks[0]!.actions?.at(-1);
      expect(action).toMatchObject({
        status: "completed",
        effects: { runs: "sealed" },
      });
      expect(await readFile(join(root, "table.csv"), "utf8")).toBe(
        "a,b\n9,9\n",
      );

      const turn = agent.snapshot().tasks[0]!.messages[0]!;
      const preview = await agent.rewinds.preview(taskId, turn.id);
      const result = await agent.commitRewind(taskId, preview.id, "restore");

      expect(result.files).toEqual(
        expect.arrayContaining([
          { path: "made.txt", status: "removed" },
          { path: "charts/chart.txt", status: "removed" },
          { path: "table.csv", status: "restored" },
        ]),
      );
      // Going back removes files: the folder the command made stays, empty.
      expect(
        (await readdir(root, { recursive: true }))
          .map((path) => path.replaceAll("\\", "/"))
          .sort(),
      ).toEqual(["charts", "notes.txt", "table.csv"]);
      expect(await readFile(join(root, "table.csv"), "utf8")).toBe(
        "a,b\n1,2\n",
      );
      expect(await readFile(join(root, "notes.txt"), "utf8")).toBe(
        "the person's notes",
      );
    });
  },
);
