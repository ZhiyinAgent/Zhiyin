/**
 * Runs one shell command in the workspace folder.
 *
 * This is the widest capability the agent has, and the only one whose effect
 * cannot be described by reading its arguments: `bash -c` can do anything the
 * person can do. Two things follow.
 *
 * The first is that the model must say, in its own words, what the command is
 * for. That sentence travels as a `claim` — never as the authoritative
 * `detail` — so a permission request can show the intent beside the exact
 * command without ever presenting an unverified sentence as an established
 * fact. The command remains the only authority on what will run.
 *
 * The second is that a command may outlive its own process. A shell that starts
 * a server, a watcher, or a build leaves descendants behind, and killing the
 * shell alone orphans them. Stopping a command here means stopping the tree.
 * Containment is supplied by the caller and is structural: it holds even when
 * this process dies without running any code. The process-ownership platform
 * owns both that structural launch and fallback cleanup where containment is
 * unavailable.
 */

import {
  runProcess,
  type LiveRun,
  type ProcessContainment,
  type ProcessRun,
} from "@zhiyin/process-ownership";
import type {
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf, facts, textDetail } from "./action-detail.js";
import { stat } from "node:fs/promises";
import { estimatedTokens } from "@zhiyin/contract";
import { describeBytes, describeCommand } from "./workspace-path.js";
import type { ConversationItems } from "./conversation-items.js";
import type { CommandJobs } from "./command-jobs.js";
import { deletionIn } from "./shell-deletion.js";
import {
  compareListings,
  listFiles,
  type CommandFiles,
} from "./command-files.js";

/**
 * Containment for one command's process tree, supplied by the application.
 * The platform owns the mechanism; this feature owns shell policy and wording.
 */
export type CommandContainment = ProcessContainment;
export type CommandContainer = ReturnType<ProcessContainment["open"]>;

/**
 * The most a command may run in all, as a job included. Long, because a job
 * is what makes a long command bearable; bounded, because nobody may be
 * watching it.
 */
const defaultTimeoutMs = 30 * 60_000;
const maximumTimeoutMs = 2 * 60 * 60_000;
/** How long a call waits before a still-running command becomes a job. */
const defaultPromoteAfterMs = 30_000;
/**
 * What the model is shown of each stream, in estimated tokens: together under
 * the limit on one result, with room for the rest of the answer. Past it, the
 * start and the end are shown and the whole output is kept to read again.
 */
const outputTokens = 5_000;
const errorTokens = 1_500;
/** Characters of each stream held in memory, start and end, to cut from. */
const heldCharacters = 400_000;
const maximumCommandLength = 8_000;
const maximumExplanationLength = 400;
/**
 * The command travels to the interface whole. A person cannot consent to a
 * command they were shown the first 160 characters of, and this is the only
 * place the exact text appears in a form they can read — so the length limit
 * belongs to the display, which can wrap or clip it in context, not here.
 */
const shownCommandLength = maximumCommandLength;

export const runCommandSpec: ToolSpec = {
  name: "bash",
  description:
    "Run one bash command starting in the current workspace folder. Use it for work no other tool covers, such as running a build, a test suite, or a version-control command. It is not confined to the workspace: it can access anything the user's account can access, reach the network, and start programs, so it always requires a person's approval. A command still running after 30 seconds carries on as a job, such as J1: the answer shows what it printed so far, job_output shows more or waits for it, stop_job stops it, and you are told when it ends.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "The command to run, as a single bash line. The working directory is the workspace root.",
      },
      explanation: {
        type: "string",
        description:
          "One plain sentence, for the person deciding whether to allow this: what the command does and what it changes. Write it for someone who does not read shell syntax. Do not claim it is safe.",
      },
      timeoutMs: {
        type: "integer",
        minimum: 1000,
        maximum: maximumTimeoutMs,
        description: `How long to let it run in all, as a job included, before stopping it. Defaults to ${defaultTimeoutMs} ms.`,
      },
    },
    required: ["command", "explanation"],
    additionalProperties: false,
  },
};

type CommandArguments = {
  readonly command: string;
  readonly explanation: string;
  readonly timeoutMs: number;
};

function commandArguments(args: unknown): CommandArguments | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const source = args as Record<string, unknown>;
  if (
    Object.keys(source).some(
      (key) => !["command", "explanation", "timeoutMs"].includes(key),
    )
  )
    return;
  const command = source["command"];
  const explanation = source["explanation"];
  if (
    typeof command !== "string" ||
    !command.trim() ||
    command.length > maximumCommandLength
  )
    return;
  if (
    typeof explanation !== "string" ||
    !explanation.trim() ||
    explanation.length > maximumExplanationLength
  )
    return;
  const timeoutMs = source["timeoutMs"] ?? defaultTimeoutMs;
  if (
    !Number.isInteger(timeoutMs) ||
    Number(timeoutMs) < 1000 ||
    Number(timeoutMs) > maximumTimeoutMs
  )
    return;
  return {
    command: command.trim(),
    explanation: explanation.trim().replace(/\s+/g, " "),
    timeoutMs: Number(timeoutMs),
  };
}

function shortened(value: string, maximum: number): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > maximum ? `${single.slice(0, maximum)}…` : single;
}

/** The start and the end of a stream, together within `tokens`. */
function boundedOutput(
  value: string,
  tokens: number,
): {
  readonly text: string;
  readonly truncated: boolean;
} {
  if (estimatedTokens(value) <= tokens)
    return { text: value, truncated: false };
  const marker = "\n… output shortened …\n";
  const bytes = Buffer.from(value, "utf8");
  const edge = Math.floor((tokens * 3 - Buffer.byteLength(marker)) / 2);
  // A cut inside a character leaves a replacement mark; it is dropped.
  const head = bytes
    .subarray(0, edge)
    .toString("utf8")
    .replace(/\uFFFD$/, "");
  const tail = bytes
    .subarray(bytes.length - edge)
    .toString("utf8")
    .replace(/^\uFFFD/, "");
  return { text: `${head}${marker}${tail}`, truncated: true };
}

/**
 * Keeps a stream whole when what the model is shown of it is only its ends,
 * and says where it was kept and how large it is.
 */
async function keptStream(
  file: string,
  tokens: number,
  context: CommandContext,
): Promise<string | undefined> {
  const { items, conversationId } = context;
  if (!items || !conversationId) return undefined;
  const size = (await stat(file)).size;
  if (Math.ceil(size / 3) <= tokens) return undefined;
  const kept = await items.keepOutput(conversationId, file);
  return kept.status === "kept"
    ? `Full output (${describeBytes(size)}) saved as output://${kept.id}; read it with read_file`
    : `The full output was not kept: ${kept.reason}`;
}

export type CommandContext = {
  readonly conversationId?: string;
  readonly items?: ConversationItems;
  /** Where a command still running when due carries on; absent, it is waited for. */
  readonly jobs?: CommandJobs;
  readonly promoteAfterMs?: number;
  /** How the folder is listed around the command; absent, it is not. */
  readonly files?: CommandFiles;
};

/** Deleting goes through delete_file, which shows what can be restored. */
function deletionRefused(command: string) {
  const deletion = deletionIn(command);
  return deletion
    ? ({
        ok: false,
        correctable: true,
        reason: `Shell commands may not delete files, and this one does (${deletion}). Use delete_file instead: it moves them to the Recycle Bin, or with mode "permanent" deletes them for good, and shows the person which before they approve.`,
      } as const)
    : undefined;
}

export function inspectRunCommand(args: unknown): ToolCallInspection {
  const input = commandArguments(args);
  if (!input) {
    return {
      ok: false,
      correctable: true,
      // The command itself is the content: a repair may not rewrite what runs.
      preserveOnRepair: ["command"],
      reason:
        "Give a single bash command and one plain sentence explaining what it does.",
    };
  }
  const refused = deletionRefused(input.command);
  if (refused) return refused;
  return {
    ok: true,
    action: "Run a command",
    target: shortened(input.command, shownCommandLength),
    claim: input.explanation,
    // A shell command declares neither. It can do anything the account can do,
    // and where it reaches is not knowable from the string, so it never
    // qualifies for the contained-read rule.
    access: "change",
    command: describeCommand(runCommandSpec.name, {
      command: input.command,
      timeoutMs: input.timeoutMs,
    }),
  };
}

export async function runShellCommand(
  shell: string,
  root: string,
  args: unknown,
  signal?: AbortSignal,
  containment?: CommandContainment,
  context: CommandContext = {},
): Promise<ToolInvocationResult> {
  const input = commandArguments(args);
  if (!input) {
    return {
      ok: false,
      correctable: true,
      // The command itself is the content: a repair may not rewrite what runs.
      preserveOnRepair: ["command"],
      reason:
        "Give a single bash command and one plain sentence explaining what it does.",
    } as ToolInvocationResult;
  }
  const refused = deletionRefused(input.command);
  if (refused) return refused;
  const listing = context.files;
  const before = listing && (await listFiles(listing, root));
  if (signal?.aborted) {
    return {
      ok: false,
      reason: "The command was stopped before it started.",
    };
  }

  const started = Date.now();
  const saved: { output?: string | undefined; errors?: string | undefined } =
    {};
  const { jobs, conversationId } = context;
  // The command's own stop. The turn's reaches it only until it is a job.
  const own = new AbortController();
  const stopWithTurn = () => own.abort();
  signal?.addEventListener("abort", stopWithTurn, { once: true });
  let live: LiveRun | undefined;
  const outcome: Promise<{
    readonly result: ToolInvocationResult;
    readonly ending: string;
  }> = runProcess({
    executable: shell,
    arguments: ["-c", input.command],
    cwd: root,
    timeoutMs: input.timeoutMs,
    signal: own.signal,
    ...(containment ? { containment } : {}),
    maximumOutputCharacters: heldCharacters,
    onStart: (running) => {
      live = running;
    },
    keep: async (files) => {
      [saved.output, saved.errors] = await Promise.all([
        keptStream(files.stdout, outputTokens, context),
        keptStream(files.stderr, errorTokens, context),
      ]);
    },
  })
    .then(async (result) => {
      const ran = runResult(result, input, started, saved);
      // A command that never started changed nothing.
      if (!listing || !before || result.failure) return ran;
      const after = await listFiles(listing, root);
      return {
        ...ran,
        result: {
          ...ran.result,
          commandChanges: compareListings(before, after, listing.kept),
        },
      };
    })
    // A job's answer is awaited by whoever asks later; it must always arrive.
    .catch(() => ({
      result: {
        ok: false,
        reason: "The command's run could not be followed to its end.",
      } satisfies ToolInvocationResult,
      ending: "could not be followed to its end.",
    }));
  const settled = async () => {
    try {
      return (await outcome).result;
    } finally {
      signal?.removeEventListener("abort", stopWithTurn);
    }
  };
  // A job outlives its call, so only a contained command may become one: its
  // tree still ends with Zhiyin, however Zhiyin ends.
  if (!containment || !jobs || !conversationId) return settled();

  let due: ReturnType<typeof setTimeout> | undefined;
  const first = await Promise.race([
    outcome.then(() => true),
    new Promise<false>((resolve) => {
      due = setTimeout(
        () => resolve(false),
        context.promoteAfterMs ?? defaultPromoteAfterMs,
      );
    }),
  ]);
  clearTimeout(due);
  if (first || !jobs.hasRoom(conversationId) || signal?.aborted)
    return settled();

  signal?.removeEventListener("abort", stopWithTurn);
  const printed = async () =>
    (await live?.printed()) ?? { stdout: "", stderr: "" };
  const job = jobs.adopt(conversationId, {
    command: shortened(input.command, 200),
    explanation: input.explanation,
    started,
    stop: () => own.abort(),
    printed,
    outcome: outcome.then(({ result }) => result),
    ending: outcome.then(({ ending }) => ending),
    changes: outcome.then(({ result }) => result.commandChanges),
  });
  const soFar = await printed();
  const out = boundedOutput(soFar.stdout, outputTokens);
  const err = boundedOutput(soFar.stderr, errorTokens);
  const seconds = Math.round((Date.now() - started) / 1000);
  return {
    ok: true,
    value: {
      command: input.command,
      job,
      status: "running",
      stdout: out.text,
      stderr: err.text,
      note: `Still running as job ${job} after ${seconds} s. Use job_output to see more or wait for it, and stop_job to stop it. You will be told when it ends.`,
    },
    ...(listing ? { commandChanges: { status: "running", job } } : {}),
    ...detailsOf(
      textDetail("Command", input.command),
      facts(["Job", job], ["Running for", `${seconds} s`]),
      textDetail("Output so far", out.text, out.truncated),
      textDetail("Errors so far", err.text, err.truncated),
    ),
  };
}

/** A finished run as the call's answer, and as a sentence for the conversation. */
function runResult(
  result: ProcessRun,
  input: CommandArguments,
  started: number,
  saved: { output?: string | undefined; errors?: string | undefined },
): { readonly result: ToolInvocationResult; readonly ending: string } {
  if (result.failure === "containment")
    return {
      result: {
        ok: false,
        reason:
          "This command was not started, because the processes it creates could not be contained.",
      },
      ending: "could not be contained.",
    };
  return {
    result: commandResult({
      command: input.command,
      started,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      ending: result.ending,
      failure:
        result.failure === "start" ? new Error("start failed") : undefined,
      timeoutMs: input.timeoutMs,
      saved,
    }),
    ending:
      result.ending === "timeout"
        ? `ran longer than ${Math.round(input.timeoutMs / 1000)} s and was stopped with everything it started. Read what it printed with job_output.`
        : result.ending === "outputLimit"
          ? "printed more than a command may and was stopped with everything it started. Read what it printed with job_output."
          : result.ending === "stopped"
            ? "was stopped with everything it started."
            : `finished with exit code ${result.exitCode}. Read what it printed with job_output.`,
  };
}

function commandResult(input: {
  readonly command: string;
  readonly started: number;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly ending: "timeout" | "stopped" | "outputLimit" | undefined;
  readonly failure: Error | undefined;
  readonly timeoutMs: number;
  readonly saved: { output?: string | undefined; errors?: string | undefined };
}): ToolInvocationResult {
  const out = boundedOutput(input.stdout, outputTokens);
  const err = boundedOutput(input.stderr, errorTokens);
  const durationMs = Date.now() - input.started;
  const shown = () =>
    detailsOf(
      textDetail("Command", input.command),
      facts(
        ["Exit code", input.exitCode ?? undefined],
        ["Took", `${durationMs} ms`],
      ),
      textDetail("Output", out.text, out.truncated),
      textDetail("Errors", err.text, err.truncated),
    );
  const observation = {
    command: input.command,
    exitCode: input.exitCode,
    stdout: out.text,
    stderr: err.text,
    outputTruncated: out.truncated || err.truncated,
    ...(input.saved.output ? { fullOutput: input.saved.output } : {}),
    ...(input.saved.errors ? { fullErrors: input.saved.errors } : {}),
    durationMs,
  };

  if (input.failure) {
    return {
      ok: false,
      reason: "The command could not be started. Check that the shell exists.",
    };
  }
  if (input.ending === "stopped") {
    return {
      ok: false,
      reason:
        "The command was stopped along with everything it started. Whatever it had already done was not undone.",
      value: observation,
      ...shown(),
    };
  }
  if (input.ending === "timeout") {
    return {
      ok: false,
      reason: `The command ran longer than ${input.timeoutMs} ms and was stopped along with everything it started. Whatever it had already done was not undone.`,
      value: observation,
      ...shown(),
    };
  }
  if (input.ending === "outputLimit") {
    return {
      ok: false,
      reason:
        "The command printed more than a command may and was stopped along with everything it started. Only the start and end of its output are shown. Whatever it had already done was not undone.",
      value: observation,
      ...shown(),
    };
  }
  if (input.exitCode !== 0) {
    // The command ran and answered; the answer is just not success. Marked
    // `reported` so it is not shown as a breakage: `command -v python3`
    // exiting 1 has told the truth about the machine.
    return {
      ok: false,
      reported: true,
      reason: `The command exited with code ${input.exitCode}.`,
      value: observation,
      ...shown(),
    };
  }
  if (
    /^(?:.*[/\\])?bash(?:\.exe)?: line \d+: .+: command not found\s*$/m.test(
      err.text,
    )
  ) {
    return {
      ok: false,
      reported: true,
      reason:
        "The shell exited with code 0, but reported a command that was not found. The intended action is not confirmed.",
      value: observation,
      ...shown(),
    };
  }
  return { ok: true, value: observation, ...shown() };
}
