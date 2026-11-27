/**
 * The other end of the `git` a sealed-off shell finds (ADR 0029). git cannot
 * start in an app container, so the container's `git` connects to a pipe only
 * its container may open and hands over its folder, its arguments and its
 * standard input; Zhiyin runs git outside the container, through the git the
 * application hands in, and answers with what git printed and its exit code.
 *
 * While git runs, every process of the conversation's container is
 * suspended, this `git` among them, and the container's git commands run one
 * at a time: what Zhiyin checks before git starts stays so until it ends.
 *
 * Each message is a frame: one byte saying what it is, four bytes of length,
 * least significant first, then that many bytes. From the container: `A` the
 * folder then each argument, UTF-8, each ended by NUL; `I` bytes of standard
 * input; `E` its end. To it: `O` standard output, `R` standard error, `X` the
 * exit code in four bytes.
 */

import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipeOpening } from "@zhiyin/sandbox";

/** One git command for the shell, as the application runs it. */
export type ShellGitCall = {
  readonly args: readonly string[];
  readonly cwd: string;
  /** The folders the shell may change: the workspace and those granted. */
  readonly folders: readonly string[];
  /** The hosts the conversation may reach, as a confinement names them. */
  readonly hosts: readonly string[];
  /** The conversation's home. */
  readonly home: string;
  readonly input?: string;
  readonly signal: AbortSignal;
};

export type ShellGitAnswer = {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  /** Each host git asked for and Zhiyin's proxy refused. */
  readonly refusedHosts: readonly string[];
  /** Whether a host sent git anything. */
  readonly received: boolean;
};

/** Runs git for a sealed-off shell, outside its container; handed in by the application. */
export type ShellGit = (call: ShellGitCall) => Promise<ShellGitAnswer>;

/**
 * A git command for the shell that Zhiyin could not run, for Zhiyin's own
 * record. The shell is told only that Zhiyin could not run git.
 */
export type ShellGitFailure = {
  readonly conversationId: string;
  /** `hold`: holding the conversation's container still; `git`: the `ShellGit`. */
  readonly step: "hold" | "git";
  readonly error: unknown;
};

/** What the git commands of one run reached, for its answer. */
export type GitTally = {
  readonly refusedHosts: Set<string>;
  received: boolean;
};

/** The most a hand-off takes for its arguments, and for its input. */
const mostArguments = 8 * 1024 * 1024;
const mostInput = 64 * 1024 * 1024;

function frame(kind: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.write(kind, 0, "latin1");
  head.writeUInt32LE(payload.length, 1);
  return Buffer.concat([head, payload]);
}

function exitFrame(code: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(code | 0);
  return frame("X", bytes);
}

/** The folder and the arguments an `A` frame carries. */
function handedCommand(
  payload: Buffer,
): { readonly cwd: string; readonly args: readonly string[] } | undefined {
  const parts = payload.toString("utf8").split("\0");
  if (parts.at(-1) !== "") return undefined;
  parts.pop();
  const [cwd, ...args] = parts;
  return cwd ? { cwd, args } : undefined;
}

/**
 * The pipe a run's `git` reaches Zhiyin through, named to it in `ZHIYIN_GIT`.
 * Each connection is one git command, refused or run as `git` decides.
 */
export function gitOpening(context: {
  readonly conversationId: string;
  readonly git: ShellGit;
  readonly folders: readonly string[];
  readonly hosts: readonly string[];
  readonly home: string;
  readonly signal: AbortSignal;
  readonly tally: GitTally;
  /**
   * Runs one git command with the conversation's container held still, so
   * nothing in it changes the folders while git looks at them and runs; one
   * command at a time.
   */
  readonly hold: <T>(work: () => Promise<T>) => Promise<T>;
  /** Keeps what stopped a command Zhiyin could not run; absent, it is not kept. */
  readonly recordFailure?: (failure: ShellGitFailure) => void;
}): PipeOpening {
  return {
    variable: "ZHIYIN_GIT",
    accept: (socket: Socket) => serve(socket, context),
  };
}

function serve(
  socket: Socket,
  context: Parameters<typeof gitOpening>[0],
): void {
  let heard = Buffer.alloc(0);
  let command:
    { readonly cwd: string; readonly args: readonly string[] } | undefined;
  let input: { path: string; stream: WriteStream; size: number } | undefined;
  let started = false;
  const stop = new AbortController();
  const ended = () => stop.abort();
  context.signal.addEventListener("abort", ended, { once: true });
  socket.once("close", () => {
    stop.abort();
    context.signal.removeEventListener("abort", ended);
  });
  socket.on("error", () => socket.destroy());

  const fail = (message: string) => {
    socket.end(
      Buffer.concat([
        frame("R", Buffer.from(`git: ${message}\n`)),
        exitFrame(128),
      ]),
    );
  };

  const run = async () => {
    started = true;
    socket.off("data", receive);
    if (input) await new Promise<void>((resolve) => input!.stream.end(resolve));
    // What git itself threw, told apart from what holding the container
    // threw, which may be thrown in its place as the container resumes.
    let gitThrew: { readonly error: unknown } | undefined;
    try {
      // The container, this `git` among it, is resumed before git's answer
      // is written to it.
      const answer = await context.hold(() =>
        context
          .git({
            args: command!.args,
            cwd: command!.cwd,
            folders: context.folders,
            hosts: context.hosts,
            home: context.home,
            signal: stop.signal,
            ...(input ? { input: input.path } : {}),
          })
          .catch((error: unknown) => {
            gitThrew = { error };
            throw error;
          }),
      );
      for (const host of answer.refusedHosts)
        context.tally.refusedHosts.add(host);
      if (answer.received) context.tally.received = true;
      if (!socket.destroyed)
        socket.end(
          Buffer.concat([
            ...(answer.stdout.length ? [frame("O", answer.stdout)] : []),
            ...(answer.stderr.length ? [frame("R", answer.stderr)] : []),
            exitFrame(answer.exitCode),
          ]),
        );
    } catch (error) {
      // The shell is told no more, so no path of this computer reaches it.
      if (!socket.destroyed) fail("Zhiyin could not run git.");
      context.recordFailure?.({
        conversationId: context.conversationId,
        step: gitThrew?.error === error ? "git" : "hold",
        error,
      });
    } finally {
      if (input) await rm(input.path, { force: true }).catch(() => undefined);
    }
  };

  const receive = (chunk: Buffer) => {
    heard = Buffer.concat([heard, chunk]);
    while (heard.length >= 5 && !started) {
      const kind = String.fromCharCode(heard[0]!);
      const length = heard.readUInt32LE(1);
      if (length > (kind === "A" ? mostArguments : mostInput)) {
        fail("the command handed to Zhiyin is too long.");
        return;
      }
      if (heard.length < 5 + length) return;
      const payload = heard.subarray(5, 5 + length);
      heard = heard.subarray(5 + length);
      if (kind === "A" && !command) {
        command = handedCommand(payload);
        if (!command) {
          fail("the command handed to Zhiyin could not be read.");
          return;
        }
      } else if (kind === "I" && command) {
        input ??= (() => {
          const path = join(tmpdir(), `zhiyin-git-input-${randomUUID()}`);
          return { path, stream: createWriteStream(path), size: 0 };
        })();
        input.size += payload.length;
        if (input.size > mostInput) {
          fail("git's input is more than 64 MB, the most Zhiyin hands it.");
          return;
        }
        input.stream.write(Buffer.from(payload));
      } else if (kind === "E" && command) {
        void run();
        return;
      } else {
        fail("the command handed to Zhiyin was not in order.");
        return;
      }
    }
  };
  socket.on("data", receive);
}
