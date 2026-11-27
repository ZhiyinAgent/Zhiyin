/**
 * The Zhiyin end of the sealed shell's `git`, reached over a socket as the
 * container's `git` reaches it: when Zhiyin cannot run the command, the shell
 * is told only that, and Zhiyin's own record says which step failed and why.
 */

import { createServer, connect, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { PipeOpening } from "@zhiyin/sandbox";
import {
  gitOpening,
  type ShellGit,
  type ShellGitFailure,
} from "../src/commands/git-handoff.js";
import { SealedShell } from "../src/commands/sealed-shell.js";

const servers: { close(): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function frame(kind: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.write(kind, 0, "latin1");
  head.writeUInt32LE(payload.length, 1);
  return Buffer.concat([head, payload]);
}

/** What the shell's `git` is answered: what it prints to standard error, and its exit code. */
type Answer = { readonly stderr: string; readonly exitCode: number };

function answerOf(bytes: Buffer): Answer {
  let stderr = "";
  let exitCode = Number.NaN;
  let at = 0;
  while (at + 5 <= bytes.length) {
    const kind = String.fromCharCode(bytes[at]!);
    const length = bytes.readUInt32LE(at + 1);
    const payload = bytes.subarray(at + 5, at + 5 + length);
    if (kind === "R") stderr += payload.toString("utf8");
    if (kind === "X") exitCode = payload.readInt32LE(0);
    at += 5 + length;
  }
  return { stderr, exitCode };
}

/** Hands `git status` to the opening, as the container's `git` does, and reads the answer. */
async function handOver(
  context: Omit<
    Parameters<typeof gitOpening>[0],
    "folders" | "hosts" | "home" | "signal" | "tally" | "conversationId"
  >,
): Promise<Answer> {
  return handOverTo(
    gitOpening({
      ...context,
      conversationId: "chat-1",
      folders: ["C:\\work"],
      hosts: [],
      home: "C:\\homes\\chat-1",
      signal: new AbortController().signal,
      tally: { refusedHosts: new Set(), received: false },
    }),
  );
}

async function handOverTo(opening: PipeOpening): Promise<Answer> {
  const server = createServer((socket) => opening.accept(socket));
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  const client = connect(port, "127.0.0.1");
  const heard: Buffer[] = [];
  client.on("data", (chunk: Buffer) => heard.push(chunk));
  const ended = new Promise<void>((resolve) =>
    client.on("close", () => resolve()),
  );
  client.write(
    Buffer.concat([
      frame("A", Buffer.from("C:\\work\0status\0", "utf8")),
      frame("E", Buffer.alloc(0)),
    ]),
  );
  await ended;
  return answerOf(Buffer.concat(heard));
}

const unanswered: ShellGit = async () => ({
  exitCode: 0,
  stdout: Buffer.alloc(0),
  stderr: Buffer.alloc(0),
  refusedHosts: [],
  received: false,
});

describe("a git command Zhiyin cannot run for the sealed shell", () => {
  it("when the container cannot be held still, tells the shell only that Zhiyin could not run git, and records that the hold failed, with its error", async () => {
    const failures: ShellGitFailure[] = [];
    const answer = await handOver({
      git: unanswered,
      hold: async () => {
        throw new Error("This container's processes cannot be suspended.");
      },
      recordFailure: (failure) => failures.push(failure),
    });

    expect(answer).toEqual({
      stderr: "git: Zhiyin could not run git.\n",
      exitCode: 128,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.conversationId).toBe("chat-1");
    expect(failures[0]!.step).toBe("hold");
    expect(failures[0]!.error).toBeInstanceOf(Error);
    expect((failures[0]!.error as Error).message).toBe(
      "This container's processes cannot be suspended.",
    );
  });

  it("when git itself throws, tells the shell only that Zhiyin could not run git, and records that git failed, with its error", async () => {
    const failures: ShellGitFailure[] = [];
    const answer = await handOver({
      git: async () => {
        throw new TypeError(
          "C:\\Program Files\\Git\\cmd\\git.exe is not there.",
        );
      },
      hold: (work) => work(),
      recordFailure: (failure) => failures.push(failure),
    });

    expect(answer).toEqual({
      stderr: "git: Zhiyin could not run git.\n",
      exitCode: 128,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.conversationId).toBe("chat-1");
    expect(failures[0]!.step).toBe("git");
    expect(failures[0]!.error).toBeInstanceOf(TypeError);
    expect((failures[0]!.error as Error).message).toBe(
      "C:\\Program Files\\Git\\cmd\\git.exe is not there.",
    );
  });

  it("when git throws and resuming the container then throws too, records that the hold failed, with the hold's error", async () => {
    const failures: ShellGitFailure[] = [];
    const answer = await handOver({
      git: async () => {
        throw new Error("git failed");
      },
      hold: async (work) => {
        await work().catch(() => undefined);
        throw new Error("The container could not be resumed.");
      },
      recordFailure: (failure) => failures.push(failure),
    });

    expect(answer.stderr).toBe("git: Zhiyin could not run git.\n");
    expect(failures.map((each) => each.step)).toEqual(["hold"]);
    expect((failures[0]!.error as Error).message).toBe(
      "The container could not be resumed.",
    );
  });

  it("is recorded through the sealed shell's setup, naming the conversation whose shell asked", async () => {
    const failures: ShellGitFailure[] = [];
    const shell = new SealedShell(
      {
        busybox: "C:\\zhiyin\\shell\\busybox.exe",
        handoff: "C:\\zhiyin\\shell\\git",
        homes: "C:\\zhiyin\\homes",
        git: async () => {
          throw new Error("git is not installed.");
        },
        recordGitFailure: (failure) => failures.push(failure),
      },
      undefined,
    );
    const run = await shell.run(
      "git status",
      "C:\\work",
      "chat-7",
      { hosts: [], read: [], change: [], registries: false },
      new AbortController().signal,
      {},
    );

    const answer = await handOverTo(run.openings[0]!);

    expect(answer).toEqual({
      stderr: "git: Zhiyin could not run git.\n",
      exitCode: 128,
    });
    expect(failures).toEqual([
      {
        conversationId: "chat-7",
        step: "git",
        error: expect.objectContaining({ message: "git is not installed." }),
      },
    ]);
  });

  it("with nowhere to record it, still answers the shell the same", async () => {
    const answer = await handOver({
      git: unanswered,
      hold: async () => {
        throw new Error("held");
      },
    });

    expect(answer).toEqual({
      stderr: "git: Zhiyin could not run git.\n",
      exitCode: 128,
    });
  });
});
