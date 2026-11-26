/**
 * The conversation's container held still while git runs for it (ADR 0029):
 * nothing in it runs between Zhiyin's checks and git's end, so a link it
 * makes meanwhile cannot lead git outside the folders. It runs again once
 * git has ended, however git ended.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { forgetConfinement, openProcessContainer } from "@zhiyin/sandbox";
import { resolveGit, shellGit } from "@zhiyin/git-connector";
import { WorkspaceTools, type ShellGit } from "@zhiyin/tools";

/** Zhiyin's shell as the gate builds it. */
const built = process.env["ZHIYIN_BUSYBOX"] ?? "";
const folders = new TemporaryFolders();
const homes = new TemporaryFolders();
let homesFolder = "";

afterEach(() => folders.removeAll());
afterAll(async () => {
  for (const name of ["start-check", "chat"])
    forgetConfinement("shell", join(homesFolder, name));
  await homes.removeAll();
});

const containment = { open: openProcessContainer };
const cmd = join(
  process.env["SystemRoot"] ?? "C:\\Windows",
  "System32",
  "cmd.exe",
).replaceAll("\\", "/");

/**
 * A conversation's sealed-off shell, its git run by `git`. A command becomes
 * a job after `promoteCommandsAfterMs`: by default later than any of these
 * scripts takes on a loaded machine, so each call answers with what its
 * command printed, as these tests read it.
 */
async function shell(git: ShellGit, promoteCommandsAfterMs = 150_000) {
  homesFolder ||= await homes.make("zhiyin-git-hold-homes-");
  const root = await folders.make("zhiyin-git-hold-");
  const tools = new WorkspaceTools(undefined, {
    containment,
    promoteCommandsAfterMs,
    sealedShell: {
      busybox: join(built, "busybox.exe"),
      handoff: join(built, "git"),
      homes: homesFolder,
      git,
    },
    reach: () => ({ hosts: [], read: [], change: [], registries: false }),
  });
  await tools.enterFolder("chat", root);
  const run = async (command: string, timeoutMs?: number) => {
    const result = await tools.execute(
      "bash",
      {
        command,
        purpose: "Use git.",
        ...(timeoutMs ? { timeoutMs } : {}),
      },
      undefined,
      "chat",
    );
    return (
      result as {
        value: { stdout: string; stderr: string; exitCode: number | null };
      }
    ).value;
  };
  return { root, run, tools };
}

/** A git that answers at once, `exitCode` 0 and nothing printed. */
const answered = {
  exitCode: 0,
  stdout: Buffer.from(""),
  stderr: Buffer.from(""),
  refusedHosts: [],
  received: false,
};

/** A loop in the background that counts in `count` every few milliseconds until `stop` is made. */
const counting = (each = "") =>
  `( i=0; while [ ! -f stop ]; do ${each} i=$((i+1)); echo $i > count; sleep 0.005; done ) &`;

/**
 * Waits for the loop's first count, then lets it run a second: a busy
 * machine may start the loop late, and a count read before it exists says
 * nothing about the hold.
 */
const countingStarted = "until [ -s count ]; do sleep 0.05; done; sleep 1";

/**
 * Reads the count into `c`, again while it is empty: the loop empties the
 * file before it writes each count, and a read can fall in between.
 */
const readCount = 'c=$(cat count); while [ -z "$c" ]; do c=$(cat count); done';

/**
 * Reads the count, then again once it has moved on, or after 30 seconds: a
 * loaded machine may take over a second for one round, and a loop that was
 * never resumed never moves.
 */
const countMovesOn = `${readCount}; before=$c; n=0; while [ $n -lt 300 ]; do ${readCount}; [ "$c" != "$before" ] && break; sleep 0.1; n=$((n+1)); done; after=$c`;

describe.runIf(process.platform === "win32" && built !== "")(
  "the container while git runs for it",
  { timeout: 180_000 },
  () => {
    it.runIf(resolveGit() !== undefined)(
      "keeps a link made in the background from leading git outside, and lets the background run on after",
      async () => {
        const outside = await folders.make("zhiyin-git-hold-outside-");
        const secret = `outside-${Date.now()}-text`;
        await writeFile(join(outside, "secret.txt"), secret);
        const { run } = await shell(shellGit({ containment }));
        // Each round tries to put a junction to the outside folder in the
        // workspace; Windows refuses a container one to a folder it may not
        // change, and Zhiyin must not depend on that alone.
        const junction = `'${cmd}' /c mklink /J "j$i" '${outside}' > /dev/null 2>&1;`;

        const ran = await run(
          [
            "git init -q",
            "git config user.name Tester && git config user.email tester@example.com",
            "echo mine > mine.txt",
            counting(junction),
            countingStarted,
            "git add -A; echo add=$?",
            countMovesOn,
            'echo "before=$before after=$after"',
            "touch stop; wait",
            `git cat-file --batch-all-objects --batch | grep -c '${secret}'; true`,
          ].join("\n"),
        );

        expect(ran.stdout, JSON.stringify(ran)).toContain("add=0");
        const [, before, after] =
          /before=(\d+) after=(\d+)/.exec(ran.stdout) ?? [];
        expect(Number(after)).toBeGreaterThan(Number(before));
        expect(ran.stdout.trim().split("\n").at(-1)).toBe("0");
      },
    );

    it("suspends every process of the container while git runs, and resumes them when it ends", async () => {
      const seen: number[] = [];
      const git: ShellGit = async (call) => {
        const count = async () =>
          Number(await readFile(join(call.cwd, "count"), "utf8"));
        seen.push(await count());
        await new Promise((resolve) => setTimeout(resolve, 700));
        seen.push(await count());
        return {
          exitCode: 0,
          stdout: Buffer.from(""),
          stderr: Buffer.from(""),
          refusedHosts: [],
          received: false,
        };
      };
      const { run } = await shell(git);

      const ran = await run(
        [
          counting(),
          countingStarted,
          "git status",
          countMovesOn,
          'echo "before=$before after=$after"',
          "touch stop; wait",
        ].join("\n"),
      );

      expect(seen, JSON.stringify(ran)).toHaveLength(2);
      expect(seen[1]).toBe(seen[0]);
      const [, before, after] =
        /before=(\d+) after=(\d+)/.exec(ran.stdout) ?? [];
      expect(Number(after)).toBeGreaterThan(Number(before));
    });

    it("holds the conversation's other commands still too, a job among them", async () => {
      const seen: number[] = [];
      const git: ShellGit = async (call) => {
        const count = async () =>
          Number(await readFile(join(call.cwd, "count"), "utf8"));
        seen.push(await count());
        await new Promise((resolve) => setTimeout(resolve, 700));
        seen.push(await count());
        return answered;
      };
      const { run, root, tools } = await shell(git, 500);
      onTestFinished(() => tools.stopAllCommands());

      const job = await run(`${counting()}\nwait`);
      // The first count is waited for here, not in a call: a call still
      // waiting after half a second answers as a job, and git would then
      // read a count the loop has not yet written.
      const written = async () =>
        (await readFile(join(root, "count"), "utf8").catch(() => "")).trim();
      await vi.waitFor(async () => expect(await written()).not.toBe(""), {
        timeout: 60_000,
      });
      await run("git status");
      // Every call here may become a job after half a second, git's too: its
      // end is waited for before the count is read.
      await vi.waitFor(() => expect(seen).toHaveLength(2), { timeout: 60_000 });
      // Read again while empty: the loop, running again, empties the file
      // before it writes each count.
      const count = async (): Promise<number> => {
        const text = await readFile(join(root, "count"), "utf8");
        return text.trim() ? Number(text) : count();
      };
      const before = await count();
      let after = before;
      for (let waited = 0; after === before && waited < 30_000; waited += 100) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        after = await count();
      }
      await writeFile(join(root, "stop"), "");

      expect(job).toMatchObject({ status: "running" });
      expect(seen[1]).toBe(seen[0]);
      expect(after).toBeGreaterThan(before);
    });

    it("runs the conversation's git commands one at a time", async () => {
      let running = 0;
      let most = 0;
      const git: ShellGit = async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 300));
        running -= 1;
        return answered;
      };
      const { run } = await shell(git);

      const ran = await run(
        "git status & git status & git status & wait; echo done",
      );

      expect(ran.stdout).toBe("done\n");
      expect(most).toBe(1);
    });

    it("resumes the container when git fails", async () => {
      const git: ShellGit = async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        throw new Error("git broke");
      };
      const { run } = await shell(git);

      const ran = await run(
        [
          counting(),
          countingStarted,
          "git status; echo status=$?",
          countMovesOn,
          'echo "before=$before after=$after"',
          "touch stop; wait",
        ].join("\n"),
      );

      expect(ran.stdout).toContain("status=128");
      const [, before, after] =
        /before=(\d+) after=(\d+)/.exec(ran.stdout) ?? [];
      expect(Number(after)).toBeGreaterThan(Number(before));
    });

    it("lets the conversation's next command and its git run once a command waiting on git is stopped by its time limit", async () => {
      let calls = 0;
      const git: ShellGit = async (call) => {
        calls += 1;
        // The first never answers until it is stopped.
        if (calls === 1)
          await new Promise((resolve) =>
            call.signal.addEventListener("abort", resolve, { once: true }),
          );
        return {
          exitCode: 0,
          stdout: Buffer.from(`git ${calls}\n`),
          stderr: Buffer.from(""),
          refusedHosts: [],
          received: false,
        };
      };
      const { run } = await shell(git);

      // Long enough for a loaded machine to reach git before the limit.
      const stopped = await run(
        `${counting()}\n${countingStarted}\ngit status`,
        20_000,
      );
      const reached = calls;
      const started = Date.now();
      const next = await run("echo next && git status");

      expect(reached, "git was called before the time limit").toBe(1);
      expect(stopped.exitCode).toBeNull();
      expect(next.stdout).toBe("next\ngit 2\n");
      expect(Date.now() - started).toBeLessThan(30_000);
    });
  },
);
