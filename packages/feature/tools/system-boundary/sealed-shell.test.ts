/**
 * Commands sealed off in Zhiyin's busybox-w32, on real app containers
 * (ADR 0029): they run without a card, reach what the conversation was
 * given and nothing more, are told what the container refused, and hand git
 * to Zhiyin. Without a container, every command asks.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { ToolInvocationResult } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/test-support";
import { forgetConfinement, openProcessContainer } from "@zhiyin/sandbox";
import {
  WorkspaceTools,
  type ShellGit,
  type ShellGitCall,
  type ShellReach,
} from "../src/index.js";

/** Zhiyin's shell as the gate builds it. */
const built = process.env["ZHIYIN_BUSYBOX"] ?? "";
const busybox = join(built, "busybox.exe");
const handoff = join(built, "git");
const folders = new TemporaryFolders();
const homes = new TemporaryFolders();
let homesFolder = "";

afterEach(() => folders.removeAll());
afterAll(async () => {
  for (const name of ["start-check", "chat-1", "chat-2"])
    forgetConfinement("shell", join(homesFolder, name));
  await homes.removeAll();
});

const nothing: ShellReach = {
  hosts: [],
  read: [],
  change: [],
  registries: false,
};

async function tools(
  options: {
    readonly reach?: ShellReach;
    readonly git?: ShellGit;
    readonly contained?: boolean;
    readonly shell?: string;
    readonly promoteAfterMs?: number;
  } = {},
) {
  homesFolder ||= await homes.make("zhiyin-shell-homes-");
  const root = await folders.make("zhiyin-sealed-work-");
  const workspace = new WorkspaceTools(undefined, {
    ...(options.promoteAfterMs === undefined
      ? {}
      : { promoteCommandsAfterMs: options.promoteAfterMs }),
    ...(options.contained === false
      ? {}
      : { containment: { open: openProcessContainer } }),
    sealedShell: {
      busybox: options.shell ?? busybox,
      handoff,
      homes: homesFolder,
      ...(options.git ? { git: options.git } : {}),
    },
    reach: () => options.reach ?? nothing,
  });
  await workspace.enterFolder("chat-1", root);
  const run = (command: string, extra: Record<string, unknown> = {}) =>
    workspace.execute(
      "bash",
      { command, purpose: "Test the sealed-off shell.", ...extra },
      undefined,
      "chat-1",
    );
  const inspect = (command: string, extra: Record<string, unknown> = {}) =>
    workspace.inspect(
      "bash",
      { command, purpose: "Test the sealed-off shell.", ...extra },
      "chat-1",
    );
  return { workspace, root, run, inspect };
}

const valueOf = (result: unknown) =>
  (result as { value: Record<string, unknown> }).value;

describe.runIf(process.platform === "win32" && built !== "")(
  "a sealed-off command",
  { timeout: 180_000 },
  () => {
    it("runs pipes, substitution, loops, background jobs and the null device without a card", async () => {
      const { run, inspect, root } = await tools();
      const script = [
        'x=$(echo sub); echo "subst=$x"',
        "for i in 1 2 3; do printf $i; done | tr 123 abc; echo",
        "sleep 1 & wait; echo background",
        "ls nothing-here 2>/dev/null || echo quiet",
        "echo hidden > /dev/null; echo shown",
        "cat < /dev/null | wc -c",
        "echo made > made.txt",
      ].join("\n");

      const inspection = await inspect(script);
      const result = await run(script);

      expect(inspection).toMatchObject({
        ok: true,
        effects: { runs: "sealed", changes: "workspace", sends: "none" },
        changesAnyFile: { writable: [] },
      });
      expect(inspection).not.toHaveProperty("asksEachTime");
      expect(result).toMatchObject({ ok: true });
      expect(String(valueOf(result)["stdout"]).split(/\r?\n/)).toEqual([
        "subst=sub",
        "abc",
        "background",
        "quiet",
        "shown",
        "0",
        "",
      ]);
      expect(await readFile(join(root, "made.txt"), "utf8")).toBe("made\n");
    });

    it("keeps the command from changing a folder it was not given, and says how to ask", async () => {
      const elsewhere = await folders.make("zhiyin-sealed-elsewhere-");
      const { run } = await tools();
      const target = join(elsewhere, "x.txt").replaceAll("\\", "/");

      const result = await run(`echo no > '${target}'`);

      expect(existsSync(join(elsewhere, "x.txt"))).toBe(false);
      expect(valueOf(result)["sealedOff"]).toContain("request_access");
    });

    it("reads a folder granted for reading and changes only the folders granted for changing", async () => {
      const readable = await folders.make("zhiyin-sealed-read-");
      const changeable = await folders.make("zhiyin-sealed-change-");
      await writeFile(join(readable, "in.txt"), "given");
      const { run, inspect } = await tools({
        reach: { ...nothing, read: [readable], change: [changeable] },
      });
      const slash = (path: string) => path.replaceAll("\\", "/");

      const inspection = await inspect("true");
      const result = await run(
        [
          `cat '${slash(join(readable, "in.txt"))}'`,
          `echo out > '${slash(join(changeable, "out.txt"))}'`,
          `echo no > '${slash(join(readable, "no.txt"))}' 2>/dev/null || echo refused`,
        ].join("; echo; "),
      );

      expect(inspection).toMatchObject({
        effects: { changes: "elsewhere" },
        changesAnyFile: { outside: [changeable] },
      });
      expect(String(valueOf(result)["stdout"])).toContain("given");
      expect(String(valueOf(result)["stdout"])).toContain("refused");
      expect(await readFile(join(changeable, "out.txt"), "utf8")).toBe("out\n");
      expect(existsSync(join(readable, "no.txt"))).toBe(false);
    });

    it("names to the model each host Zhiyin's proxy refused", async () => {
      const { run, inspect } = await tools({
        reach: { ...nothing, hosts: ["allowed.example.com"] },
      });
      const curl = join(
        process.env["SystemRoot"] ?? "C:\\Windows",
        "System32",
        "curl.exe",
      ).replaceAll("\\", "/");

      const inspection = await inspect("true");
      const result = await run(
        `'${curl}' -s -m 20 https://example.org/ ; true`,
      );

      expect(inspection).toMatchObject({
        effects: { sends: "service" },
        destinations: ["allowed.example.com"],
      });
      expect(valueOf(result)["refusedHosts"]).toEqual(["example.org"]);
      expect(valueOf(result)["sealedOff"]).toContain("example.org");
    });

    it("tells the conversation what the container refused a command that carried on as a job, once it ends", async () => {
      const { workspace, run } = await tools({
        reach: { ...nothing, hosts: ["allowed.example.com"] },
        promoteAfterMs: 300,
      });
      const curl = join(
        process.env["SystemRoot"] ?? "C:\\Windows",
        "System32",
        "curl.exe",
      ).replaceAll("\\", "/");
      const ended = new Promise<string>((resolve) =>
        workspace.onCommandEnded((_conversation, notice) => resolve(notice)),
      );
      const answered = new Promise<ToolInvocationResult>((resolve) =>
        workspace.onJobChanges((_conversation, _job, _changes, outcome) =>
          resolve(outcome),
        ),
      );

      const started = await run(
        `sleep 2; '${curl}' -s -m 20 https://example.org/ ; true`,
      );

      expect(valueOf(started)["status"]).toBe("running");
      expect(await ended).toContain("refused it example.org");
      expect(valueOf(await answered)["refusedHosts"]).toEqual(["example.org"]);
    });

    it("hands git's arguments, folder and input to Zhiyin, and git's answer back", async () => {
      const calls: (ShellGitCall & { readonly given: string })[] = [];
      const git: ShellGit = async (call) => {
        const given = call.input ? await readFile(call.input, "utf8") : "";
        calls.push({ ...call, given });
        return {
          exitCode: 3,
          stdout: Buffer.from(`git saw ${call.args.join(" ")}\n`),
          stderr: Buffer.from("from git\n"),
          refusedHosts: [],
          received: false,
        };
      };
      const { run, root } = await tools({ git });

      const result = await run(
        "mkdir sub && cd sub && echo piped | git hash-object --stdin; echo code=$?",
      );

      expect(String(valueOf(result)["stdout"])).toContain(
        "git saw hash-object --stdin\ncode=3",
      );
      expect(String(valueOf(result)["stderr"])).toContain("from git");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        args: ["hash-object", "--stdin"],
        given: "piped\n",
        folders: [root],
      });
      expect(calls[0]!.cwd.toLowerCase()).toBe(join(root, "sub").toLowerCase());
    });

    it("waits for the command it runs last, as a shell's exec does", async () => {
      // The shell cannot see its parent outside the container.
      const { run } = await tools();
      const curl = join(
        process.env["SystemRoot"] ?? "C:\\Windows",
        "System32",
        "curl.exe",
      ).replaceAll("\\", "/");

      const result = await run(`true && '${curl}' --version`);

      expect(String(valueOf(result)["stdout"])).toMatch(/^curl \d/);
    });

    it("removes a conversation's home once the conversation is gone, and starts the next afresh", async () => {
      const { workspace, run } = await tools();
      await run('echo mine > "$HOME/note.txt"');
      const home = join(homesFolder, "chat-1");
      expect(existsSync(join(home, "note.txt"))).toBe(true);

      await workspace.forgetConversation("chat-1");
      const root = await folders.make("zhiyin-sealed-again-");
      await workspace.enterFolder("chat-1", root);
      const again = await run('cat "$HOME/note.txt" 2>/dev/null || echo none');

      expect(String(valueOf(again)["stdout"])).toBe("none\n");
      await workspace.forgetConversation("chat-1");
      expect(existsSync(home)).toBe(false);
    });

    it("keeps one conversation's home from another's", async () => {
      const { workspace, run } = await tools();
      const other = await folders.make("zhiyin-sealed-other-");
      await workspace.enterFolder("chat-2", other);

      await run('echo mine > "$HOME/note.txt"');
      const second = await workspace.execute(
        "bash",
        { command: 'cat "$HOME/note.txt" || echo none', purpose: "Look." },
        undefined,
        "chat-2",
      );

      expect(String(valueOf(second)["stdout"])).toContain("none");
    });

    it("tells the model its shell is busybox sh, sealed off, and offers the way to ask for more", async () => {
      const { workspace } = await tools();
      // The description follows the start check, which the first call makes.
      await workspace.inspect(
        "bash",
        { command: "true", purpose: "Check." },
        "chat-1",
      );
      const offered = workspace.list("chat-1");
      const bash = offered.find((tool) => tool.name === "bash")?.description;

      expect(bash).toContain("the shell is busybox sh, not bash");
      expect(bash).toContain("runs sealed off");
      expect(bash).toContain("request_access");
      expect(offered.map((tool) => tool.name)).toContain("request_access");
    });

    it("builds a request's card from what Zhiyin checked, the model's reason as its claim", async () => {
      const { workspace } = await tools();
      const data = await folders.make("zhiyin-sealed-data-");

      const website = await workspace.inspect(
        "request_access",
        { host: "api.example.com", purpose: "Download the dataset." },
        "chat-1",
      );
      const folder = await workspace.inspect(
        "request_access",
        { folder: data, access: "change", purpose: "Write the report there." },
        "chat-1",
      );

      expect(website).toMatchObject({
        ok: true,
        asksEachTime: true,
        target: "example.com and every name below it",
        claim: "Download the dataset.",
        grants: { kind: "website", hosts: ["example.com", "*.example.com"] },
      });
      expect(folder).toMatchObject({
        ok: true,
        asksEachTime: true,
        target: data,
        grants: { kind: "folder", folder: data, access: "change" },
      });
    });

    it("runs a command with full access only when asked, with today's card", async () => {
      const { inspect } = await tools();

      expect(await inspect("echo hi", { full_access: true })).toMatchObject({
        ok: true,
        asksEachTime: true,
        effects: { runs: "full-access" },
      });
    });
  },
);

describe.runIf(process.platform === "win32" && built !== "")(
  "the shell as built",
  () => {
    it("dates its build in UTC, so it is built the same in any time zone", () => {
      const ran = spawnSync(busybox, [], { encoding: "utf8" });
      const banner = `${ran.stdout}${ran.stderr}`.split("\n")[0];

      expect(banner).toMatch(
        /^BusyBox v\S+ \(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\)/,
      );
    });
  },
);

describe.runIf(process.platform === "win32" && built !== "")(
  "the shell where commands cannot be sealed off",
  { timeout: 120_000 },
  () => {
    it("asks every time, and says why in its description, when the shell fails its start check in a container", async () => {
      const broken = join(
        await folders.make("zhiyin-sealed-broken-"),
        "busybox.exe",
      );
      await writeFile(broken, "not a program");
      const { workspace, inspect } = await tools({ shell: broken });

      const inspection = await inspect("echo hi");
      const described = workspace
        .list("chat-1")
        .find((tool) => tool.name === "bash")?.description;

      expect(inspection).toMatchObject({
        ok: true,
        asksEachTime: true,
        effects: { runs: "full-access" },
      });
      expect(described).toContain("did not start sealed off");
      expect(workspace.list("chat-1").map((tool) => tool.name)).not.toContain(
        "request_access",
      );
    });
  },
);
