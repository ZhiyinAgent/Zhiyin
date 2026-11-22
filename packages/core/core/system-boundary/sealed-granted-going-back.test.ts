/**
 * Going back over sealed-off commands in real app containers (ADR 0029, ADR
 * 0031), as they reach a folder the person granted for changing and a folder
 * of more files than are watched at once: a change there is put back as the
 * message found it, whether the grant was made in the same turn or before;
 * and a file too large to save at once is held read-only from a command
 * until prepare_change saves it.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ModelRequest } from "@zhiyin/model-client";
import { sourceWatchThread } from "@zhiyin/file-watch";
import { replaceFile } from "@zhiyin/files";
import { FileRecovery } from "@zhiyin/recovery";
import { ConversationRewind } from "@zhiyin/rewind-planner";
import {
  forgetConfinement,
  openProcessContainer,
  readOnlyHolds,
} from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { WorkspaceTools } from "@zhiyin/tools";
import {
  loopFrom,
  stubDependencies,
  until,
  type TestApp,
} from "../test/app/support.js";

/** Zhiyin's shell as the gate builds it. */
const built = process.env["ZHIYIN_BUSYBOX"] ?? "";
const folders = new TemporaryFolders();
const kept = new TemporaryFolders();
const homes = new TemporaryFolders();
let homesFolder = "";
/** A folder of 19,999 files, which leaves room to watch one more. */
let busy = "";
const open: FileRecovery[] = [];

afterEach(async () => {
  for (const recovery of open.splice(0)) await recovery.close();
  await folders.removeAll();
});
afterAll(async () => {
  for (const name of await readdir(homesFolder).catch(() => []))
    forgetConfinement("shell", join(homesFolder, name));
  await homes.removeAll();
  await kept.removeAll();
});

const mib = 1024 * 1024;
const slashed = (path: string) => path.replaceAll("\\", "/");

/** Writes `count` small files into `folder`, a thousand to a folder. */
async function smallFiles(folder: string, count: number, text: string) {
  for (let start = 0; start < count; start += 500) {
    const sub = join(folder, `part-${Math.floor(start / 1000)}`);
    await mkdir(sub, { recursive: true });
    await Promise.all(
      Array.from({ length: Math.min(500, count - start) }, (_, offset) =>
        writeFile(
          join(sub, `${start + offset}.txt`),
          `${text} ${start + offset}\n`,
        ),
      ),
    );
  }
}

/** A step of the model's: a tool call, or an answer that ends the turn. */
type Step =
  | {
      readonly tool: string;
      readonly args: Record<string, unknown>;
      /** What something else does first, as the model answers. */
      readonly meanwhile?: () => Promise<void>;
    }
  | "answer";

/**
 * The app over `root` with Zhiyin's sealed-off shell, real file recovery
 * with its watch, and runs held as the app holds them. Each message the
 * person sends plays its own list of steps, one a round.
 */
async function app(root: string, turns: readonly (readonly Step[])[]) {
  const storage = await folders.make("zhiyin-granted-back-store-");
  const holdsData = await folders.make("zhiyin-granted-back-holds-");
  homesFolder ||= await homes.make("zhiyin-granted-back-homes-");
  // What the conversation's grants reach, once the app is there to say.
  let reachOf: TestApp["shellReach"] = () => ({
    hosts: [],
    read: [],
    change: [],
    registries: false,
  });
  const workspace = new WorkspaceTools(root, {
    containment: { open: openProcessContainer },
    // Each command ends within its call, however slow a loaded machine makes
    // it, rather than becoming a job.
    promoteCommandsAfterMs: 150_000,
    sealedShell: {
      busybox: join(built, "busybox.exe"),
      handoff: join(built, "git"),
      homes: homesFolder,
    },
    reach: (taskId) => reachOf(taskId),
  });
  const recovery = new FileRecovery(storage, {
    list: workspace.listWorkspace,
    watch: sourceWatchThread,
  });
  open.push(recovery);
  const deps = stubDependencies(() => {});
  const answers: string[] = [];
  let request = 0;
  const agent = loopFrom({
    ...deps,
    permissions: {
      decide: async () => ({ outcome: "allow", reason: "Test policy." }),
    },
    tools: workspace,
    commands: workspace,
    workspace,
    recovery,
    runs: {
      holds: readOnlyHolds(holdsData, { replace: replaceFile }),
      programLocations: async () => [],
      startupFolders: () => [],
    },
    rewind: new ConversationRewind(() => `granted-back-${request}`),
    model: {
      ...deps.model,
      send: async function* (asked: ModelRequest) {
        request += 1;
        // The person's own messages, not Zhiyin's notices, begin a turn; each
        // answer of the model's since is a step taken.
        const spoken = asked.messages.flatMap((message, index) =>
          message.role === "user" &&
          !(
            typeof message.content === "string" &&
            message.content.startsWith("<zhiyin-")
          )
            ? [index]
            : [],
        );
        const turn = spoken.length - 1;
        const step = asked.messages
          .slice(spoken.at(-1) ?? 0)
          .filter((message) => message.role === "assistant").length;
        const last = asked.messages.at(-1);
        if (last?.role === "tool") answers.push(last.content);
        const next = turns[turn]?.[step] ?? "answer";
        if (next === "answer" || !asked.tools?.length)
          yield { kind: "textDelta", text: "Done." };
        else {
          await next.meanwhile?.();
          yield {
            kind: "toolCallDelta",
            index: 0,
            callId: `call-${request}`,
            name: next.tool,
            argumentsDelta: JSON.stringify(next.args),
          };
        }
        yield { kind: "done" };
      },
    },
  });
  reachOf = (taskId) => agent.shellReach(taskId);
  await agent.selectWorkspace(root);
  const taskId = await agent.createTask();
  const task = () => agent.snapshot().tasks.find((each) => each.id === taskId)!;
  /** Sends a message and lets each card the turn shows be allowed. */
  const send = async (text: string) => {
    let finished = false;
    const running = agent.start(taskId, text).finally(() => {
      finished = true;
    });
    for (;;) {
      await until(() => finished || task().phase.kind === "approval");
      const phase = task().phase;
      if (finished || phase.kind !== "approval") break;
      await agent.resolveApproval(taskId, phase.prompt.id, "allow");
    }
    await running;
  };
  const goBackTo = async (text: string) => {
    const message = task().messages.find((each) => each.text === text)!;
    const preview = await agent.rewinds.preview(taskId, message.id);
    return agent.commitRewind(taskId, preview.id, "restore");
  };
  return { agent, recovery, task, send, goBackTo, answers };
}

const bash = (command: string): Exclude<Step, "answer"> => ({
  tool: "bash",
  args: { command, purpose: "Change the files." },
});

describe.runIf(process.platform === "win32" && built !== "")(
  "going back over sealed-off commands",
  { timeout: 600_000 },
  () => {
    beforeAll(async () => {
      busy = await kept.make("zhiyin-granted-back-busy-");
      await smallFiles(busy, 19_999, "watched elsewhere");
    }, 600_000);

    it("puts back what a command changed in a folder granted for changing, granted in its turn or before", async () => {
      const parent = await folders.make("zhiyin-granted-back-");
      const root = join(parent, "workspace");
      const elsewhere = join(parent, "elsewhere");
      await mkdir(root);
      await mkdir(elsewhere);
      const table = join(elsewhere, "table.csv");
      await writeFile(table, "as the person left it");
      const { task, send, goBackTo } = await app(root, [
        [
          {
            tool: "request_access",
            args: {
              folder: elsewhere,
              access: "change",
              purpose: "Write the table there.",
            },
          },
          bash(`printf 'as the first turn left it' > '${slashed(table)}'`),
        ],
        [
          {
            ...bash(
              `printf 'as the second turn left it' > '${slashed(table)}'`,
            ),
            // Written as the second turn runs, before its command: kept as
            // the turn found it only by the watch its grant began.
            meanwhile: () => writeFile(table, "written meanwhile"),
          },
        ],
      ]);

      await send("Fill the table");
      await send("Fill it again");

      expect(task().conversationPermissions).toEqual([
        expect.objectContaining({ kind: "outside-folder" }),
      ]);
      expect(task().actions?.map((action) => action.status)).toEqual([
        "completed",
        "completed",
        "completed",
      ]);
      expect(await readFile(table, "utf8")).toBe("as the second turn left it");

      await goBackTo("Fill it again");
      expect(await readFile(table, "utf8")).toBe("as the first turn left it");
      await goBackTo("Fill the table");
      expect(await readFile(table, "utf8")).toBe("as the person left it");
    });

    it("in a folder of more than 20,000 files, holds the largest file from a command until prepare_change saves it, and puts back every change", async () => {
      const root = await folders.make("zhiyin-granted-back-many-");
      await smallFiles(root, 20_001, "a small note");
      const large = (fill: number) => Buffer.alloc(5 * mib, fill);
      await writeFile(join(root, "large-0.bin"), large(1));
      await writeFile(
        join(root, "large-1.bin"),
        Buffer.concat([large(2), large(2)]),
      );
      const note = join(root, "part-7", "7123.txt");
      const larger = join(root, "large-1.bin");
      const { recovery, send, goBackTo, answers } = await app(root, [
        [
          bash(
            `printf changed > '${slashed(note)}'; printf changed > large-1.bin || echo was-refused`,
          ),
          { tool: "prepare_change", args: { path: "large-1.bin" } },
          bash("printf changed > large-1.bin"),
        ],
      ]);
      // Another conversation's turn takes all but one of the watch's room.
      await recovery.beginTurn("another", [busy]);

      await send("Change the files");
      await recovery.endTurn("another");

      expect(answers[0]).toContain("was-refused");
      expect(answers[1]).toContain("Run the command that changes it now.");
      expect(answers[2]).not.toContain("was-refused");
      expect(await readFile(note, "utf8")).toBe("changed");
      expect(await readFile(larger, "utf8")).toBe("changed");

      await goBackTo("Change the files");
      expect(await readFile(note, "utf8")).toBe("a small note 7123\n");
      expect(
        (await readFile(larger)).equals(Buffer.concat([large(2), large(2)])),
      ).toBe(true);
      expect((await readFile(join(root, "large-0.bin"))).equals(large(1))).toBe(
        true,
      );
    });

    it("holds a large file of a folder granted for changing until prepare_change saves it by its whole path, and puts it back", async () => {
      const parent = await folders.make("zhiyin-granted-back-held-");
      const root = join(parent, "workspace");
      const elsewhere = join(parent, "elsewhere");
      await mkdir(root);
      await mkdir(elsewhere);
      await writeFile(join(root, "notes.txt"), "the person's notes");
      const scan = join(elsewhere, "scan.bin");
      const original = Buffer.alloc(5 * mib, 7);
      await writeFile(scan, original);
      await writeFile(join(elsewhere, "other.bin"), Buffer.alloc(6 * mib, 8));
      const { recovery, send, goBackTo, answers } = await app(root, [
        [
          {
            tool: "request_access",
            args: {
              folder: elsewhere,
              access: "change",
              purpose: "Change the scan.",
            },
          },
        ],
        [
          bash(`printf changed > '${slashed(scan)}' || echo was-refused`),
          { tool: "prepare_change", args: { path: scan } },
          bash(`printf changed > '${slashed(scan)}'`),
        ],
      ]);
      await send("May you change the scan?");
      // Another conversation's turn takes all but one of the watch's room,
      // which the workspace's one file takes.
      await recovery.beginTurn("another", [busy]);

      await send("Change the scan");
      await recovery.endTurn("another");

      expect(answers[1]).toContain("was-refused");
      expect(answers[2]).toContain("Run the command that changes it now.");
      expect(await readFile(scan, "utf8")).toBe("changed");

      await goBackTo("Change the scan");
      expect((await readFile(scan)).equals(original)).toBe(true);
    });
  },
);
