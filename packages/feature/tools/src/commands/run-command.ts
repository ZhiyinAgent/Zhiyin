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
 * this process dies without running any code. The sandbox platform
 * owns both that structural launch and fallback cleanup where containment is
 * unavailable.
 */

import {
  printedText,
  runProcess,
  type LiveRun,
  type ProcessContainment,
  type ProcessRun,
} from "@zhiyin/sandbox";
import type {
  CommandFileChange,
  CommandFileChanges,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf, facts, textDetail } from "../shared/action-detail.js";
import { effectsOf } from "../shared/effects.js";
import { schemaInput, withSchemaProblems } from "@zhiyin/tool-input";
import { shortened, startAndEnd } from "@zhiyin/text-and-names";
import { readFile, stat } from "node:fs/promises";
import {
  bytesForTokens,
  estimatedTokens,
  tokensForBytes,
  utf8Bytes,
} from "@zhiyin/context-budget";
import { describeBytes, describeCommand } from "../shared/workspace-path.js";
import type { ConversationItems } from "../shared/conversation-items.js";
import type { CommandJobs } from "./command-jobs.js";
import { deletionIn } from "./deletion.js";
import {
  compareListings,
  listFiles,
  type ListingSetup,
} from "@zhiyin/workspace-listing";
import type { ToolDefinition } from "../tool-definition.js";
import {
  nothingGranted,
  type ConversationReach,
  type ShellReach,
} from "./reach.js";
import type { SealedRun, SealedUse } from "./sealed-shell.js";
import type { CommandShell } from "./shell.js";

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
/**
 * Output is read as UTF-8. Python on Windows otherwise writes in the console's
 * code page, garbling text or stopping at a character the page cannot hold.
 */
const commandEnvironment = () => ({
  ...process.env,
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
});

/** How jobs work, said in each description of the tool. */
const jobsSaid =
  "A command still running after 30 seconds carries on as a job, such as J1: the answer shows what it printed so far, job_output shows more or waits for it, stop_job stops it, and you are told when it ends. A conversation keeps at most three jobs running; while it has three, a further command runs to its end before answering.";

/** Said after what the shell is, whichever it is. */
const exitCodeSaid =
  "A command's exit code does not prove it had the intended effect: check the effect itself, such as that a service stopped, and do not hide a failure behind a fallback that always succeeds.";

/** What the rest of each description says, whichever way commands run. */
const commonSaid = [
  "It does not delete files: delete with delete_file, which moves them to the Recycle Bin. Python here is whichever the account has, if any: check which interpreters exist first, and never install packages into a global Python.",
  "For files, find_files finds them by name, search_files finds text in them, and the other file tools list, read, write, edit and move them. For Python, use the Python tool when one is offered.",
];

/** What the shell is, for the model, which writes bash unless told. */
const busyboxSaid =
  "This computer runs Windows, and the shell is busybox sh, not bash: a POSIX shell with some of bash's extensions and no arrays, whose Unix tools (grep, sed, awk, find, tr, xargs, wc and the rest) are busybox's own. Bash-only syntax fails: rewrite it in POSIX sh.";

/** The tool's description, by whether commands run sealed off here and why not. */
function descriptionFor(use: SealedUse, busybox: boolean): string {
  if (use.sealed)
    return [
      `Run one shell command in the workspace folder, for work no other tool covers, such as a build, a test suite, an install into the workspace or git. ${jobsSaid}`,
      `${busyboxSaid} ${exitCodeSaid}`,
      "A command runs sealed off, in a container of this conversation's own, without asking the person. It reads the workspace, Zhiyin's tools, Windows' own files and the folders granted for reading; it changes the workspace and the folders granted for changing, and each change is saved so going back undoes it; its home keeps tools' caches and settings (npm, pip, cargo) for the conversation; it reaches only the websites on the conversation's list, the package registries and Git hosts Zhiyin lists among them, over HTTPS through Zhiyin's proxy, and never a server of this computer's. /dev/null works, but a program that opens NUL itself fails sealed off.",
      "A refusal is the container's, not a fault: a host the proxy refused is named in the answer, and Permission denied on a path outside what the command reaches means it was not given. Ask for a website or a folder with request_access. git runs through Zhiyin, in the workspace or a folder granted for changing, without the repository's hooks, filters, aliases that run commands or other programs, over HTTPS only and with none of the person's credentials.",
      "show_ports shows ports of the container on this computer, such as a dev server's, while the command runs: the answer gives the address the person opens. A server and a test that calls it meet inside the container.",
      "full_access: true runs the command with the person's full access instead, and the person approves it each time: only for what a container cannot do, such as installing for the whole computer, pushing with the person's credentials, a tool installed only in the person's profile, or a program that fails sealed off.",
      ...commonSaid,
    ].join("\n\n");
  return [
    `Run one shell command in the workspace folder, for work no other tool covers, such as a build, a test suite or a version-control command. It runs with the person's full access, can reach the network and start programs, and the person approves each command: ${use.why} ${jobsSaid}`,
    `${
      busybox
        ? busyboxSaid
        : "This computer runs Windows, and the shell is Git Bash: do not assume Linux utilities are installed."
    } ${exitCodeSaid}`,
    ...commonSaid,
  ].join("\n\n");
}

const runCommandSpec: ToolSpec = {
  name: "bash",
  checksWork: "runs",
  description: descriptionFor(
    { sealed: false, why: "no command can be sealed off here." },
    false,
  ),
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        maxLength: maximumCommandLength,
        description:
          "One shell command, which may span lines. The working directory is the workspace root.",
      },
      full_access: {
        type: "boolean",
        description:
          "Run with the person's full access, asked each time, for what a sealed-off command cannot do. Leave it out otherwise.",
      },
      show_ports: {
        type: "array",
        maxItems: 4,
        items: { type: "integer", minimum: 1, maximum: 65535 },
        description:
          "Ports of the command's container to show on this computer while it runs, such as [5173] for a dev server.",
      },
      purpose: {
        type: "string",
        maxLength: maximumExplanationLength,
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
    required: ["command", "purpose"],
    additionalProperties: false,
  },
};

type CommandArguments = {
  readonly command: string;
  readonly explanation: string;
  readonly timeoutMs: number;
  readonly fullAccess: boolean;
  readonly ports: readonly number[];
};

/** Why a call's input is refused, naming a limit it went past. */
function inputRefusal(args: unknown): string {
  const source =
    args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const { command, purpose } = source;
  const count = (value: number) => value.toLocaleString("en-US");
  if (typeof command === "string" && command.length > maximumCommandLength)
    return `The command is ${count(command.length)} characters, and a command may be at most ${count(maximumCommandLength)}. Write the longer part to a file with write_file, then run that file.`;
  if (typeof purpose === "string" && purpose.length > maximumExplanationLength)
    return `The purpose is ${count(purpose.length)} characters, and it may be at most ${count(maximumExplanationLength)}: one plain sentence.`;
  return withSchemaProblems(
    "Give a single bash command and one plain sentence explaining what it does.",
    args,
    runCommandSpec.inputSchema,
  );
}

function commandArguments(args: unknown): CommandArguments | undefined {
  const input = schemaInput<{
    readonly command: string;
    readonly purpose: string;
    readonly timeoutMs?: number;
    readonly full_access?: boolean;
    readonly show_ports?: readonly number[];
  }>(runCommandSpec.inputSchema, args);
  if (!input?.command.trim() || !input.purpose.trim()) return;
  return {
    command: input.command.trim(),
    explanation: input.purpose.trim().replace(/\s+/g, " "),
    timeoutMs: input.timeoutMs ?? defaultTimeoutMs,
    fullAccess: input.full_access === true,
    ports: [...new Set(input.show_ports ?? [])],
  };
}

/** A command on one line, cut to `maximum` characters. */
function oneLine(command: string, maximum: number): string {
  return shortened(command.replace(/\s+/g, " ").trim(), maximum);
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
  const edge = Math.floor((bytesForTokens(tokens) - utf8Bytes(marker)) / 2);
  return { text: startAndEnd(value, edge, marker), truncated: true };
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
  // A byte decodes to at most three UTF-8 bytes, a token's worth: up to
  // `tokens` bytes always fit, past three times that never do, and between
  // the two only the text as decoded can say, as a console code page does.
  if (size <= tokens) return undefined;
  if (
    tokensForBytes(size) <= tokens &&
    estimatedTokens(printedText(await readFile(file))) <= tokens
  )
    return undefined;
  const kept = await items.keepOutput(conversationId, file);
  return kept.status === "kept"
    ? `Full output (${describeBytes(size)}) saved as output://${kept.id}; read it with read_file`
    : `The full output was not kept: ${kept.reason}`;
}

type CommandContext = {
  readonly conversationId?: string;
  readonly items?: ConversationItems;
  /** Where a command still running when due carries on; absent, it is waited for. */
  readonly jobs?: CommandJobs;
  readonly promoteAfterMs?: number;
  /** How the folder is listed around the command; absent, it is not. */
  readonly files?: ListingSetup;
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

/**
 * How a sealed-off command is decided (ADR 0029): by what its container
 * allows, which this code sets, never by its text. It reads the workspace,
 * and changes it and each folder granted for changing, all copied first; it
 * runs code sealed off; and it sends only to the hosts on the conversation's
 * list, which the person granted or Zhiyin lists, so where it sends is not
 * the model's to choose. What it receives is known only once it ran.
 */
function inspectSealedCommand(
  input: CommandArguments,
  reach: ShellReach,
  hosts: readonly string[],
): ToolCallInspection {
  const outside = reach.change;
  return {
    ok: true,
    action: "Run a sealed-off command",
    target: oneLine(input.command, shownCommandLength),
    claim: input.explanation,
    effects: effectsOf({
      reads: "workspace",
      changes: outside.length ? "elsewhere" : "workspace",
      sends: hosts.length ? "service" : "none",
      runs: "sealed",
    }),
    // Copied before it runs, so going back undoes what it changed; Git's
    // folder and Startup folders are held from it (ADR 0012).
    changesAnyFile: {
      writable: [],
      ...(outside.length ? { outside } : {}),
    },
    reachesGrants: true,
    ...(hosts.length ? { destinations: hosts } : {}),
    command: describeCommand(runCommandSpec.name, {
      command: input.command,
      timeoutMs: input.timeoutMs,
      ...(input.ports.length ? { show_ports: input.ports } : {}),
    }),
    invocation: {
      name: runCommandSpec.name,
      arguments: [
        { name: "command", value: input.command, runs: true },
        {
          name: "Stops after",
          value: duration(input.timeoutMs),
          readable: true,
        },
      ],
    },
  };
}

function inspectRunCommand(
  args: unknown,
  sealed?: { readonly reach: ShellReach; readonly hosts: readonly string[] },
): ToolCallInspection {
  const input = commandArguments(args);
  if (!input) {
    return {
      ok: false,
      correctable: true,
      reason: inputRefusal(args),
    };
  }
  const refused = deletionRefused(input.command);
  if (refused) return refused;
  if (input.ports.length && (input.fullAccess || !sealed))
    return {
      ok: false,
      correctable: true,
      reason:
        "show_ports shows a sealed-off command's container; a command with full access listens on this computer itself.",
    };
  if (sealed && !input.fullAccess)
    return inspectSealedCommand(input, sealed.reach, sealed.hosts);
  return {
    ok: true,
    action: "Run a command",
    target: oneLine(input.command, shownCommandLength),
    claim: input.explanation,
    // No grant covers a shell command: it can do anything the account can
    // do, and where it reaches is not knowable from the string.
    asksEachTime: true,
    // What a command does is not knowable from its text: it runs with the
    // person's rights, may reach anything on this computer and send anything
    // anywhere, and prints what it read, which may be anyone's.
    effects: effectsOf({
      reads: "elsewhere",
      changes: "elsewhere",
      sends: "chosen",
      runs: "full-access",
      brings: "outside",
    }),
    // Its changes in the workspace are copied first, so they can be undone;
    // it is not sealed off, so nothing is held from it (ADR 0012).
    changesAnyFile: { writable: [] },
    command: describeCommand(runCommandSpec.name, {
      command: input.command,
      timeoutMs: input.timeoutMs,
    }),
    // The command is what runs, so the window draws it as the command; the
    // purpose is the claim above, and the limit is said in words.
    invocation: {
      name: runCommandSpec.name,
      arguments: [
        { name: "command", value: input.command, runs: true },
        {
          name: "Stops after",
          value: duration(input.timeoutMs),
          readable: true,
        },
      ],
    },
  };
}

/** A time limit as a person reads it, exactly. */
function duration(ms: number): string {
  if (ms % 60_000 === 0) return `${ms / 60_000} min`;
  if (ms % 1000 === 0) return `${ms / 1000} s`;
  return `${ms} ms`;
}

async function runShellCommand(
  shell: string,
  root: string,
  args: unknown,
  {
    signal,
    containment,
    context = {},
    sealed,
  }: {
    readonly signal?: AbortSignal | undefined;
    readonly containment?: CommandContainment | undefined;
    readonly context?: CommandContext;
    /** How the command starts sealed off; absent, it runs with full access. */
    readonly sealed?: ((stop: AbortSignal) => Promise<SealedRun>) | undefined;
  } = {},
): Promise<ToolInvocationResult> {
  const input = commandArguments(args);
  if (!input) {
    return {
      ok: false,
      correctable: true,
      reason: inputRefusal(args),
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
  const confined = await sealed?.(own.signal);
  const outcome: Promise<{
    readonly result: ToolInvocationResult;
    readonly ending: string;
  }> = runProcess({
    executable: confined?.executable ?? shell,
    arguments: confined?.arguments ?? [
      ...(shell.toLowerCase().endsWith("busybox.exe") ? ["sh"] : []),
      "-c",
      input.command,
    ],
    cwd: root,
    environment: confined?.environment ?? commandEnvironment(),
    ...(confined
      ? {
          confinement: confined.confinement,
          openings: confined.openings,
          ...(input.ports.length ? { shownPorts: input.ports } : {}),
        }
      : {}),
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
      const ran = confined
        ? sealedResult(
            runResult(result, input, started, saved),
            result,
            confined,
            live,
          )
        : runResult(result, input, started, saved);
      // A command that never started changed nothing.
      if (!listing || !before || result.failure)
        return { ...ran, ending: endingSentence(ran.ending, result) };
      const after = await listFiles(listing, root);
      const changes = compareListings(before, after, listing.kept);
      return {
        result: { ...ran.result, commandChanges: changes },
        ending: endingSentence(ran.ending, result, changes),
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
    command: oneLine(input.command, 200),
    explanation: input.explanation,
    started,
    stop: () => own.abort(),
    printed,
    shown: async () => {
      const now = await printed();
      const out = boundedOutput(now.stdout, outputTokens);
      const err = boundedOutput(now.stderr, errorTokens);
      return {
        stdout: out.text,
        stderr: err.text,
        outputTruncated: out.truncated || err.truncated,
      };
    },
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
      note: `Still running as job ${job} after ${seconds} s. Use job_output to see more or wait for it, and stop_job to stop it. You will be told when it ends.${
        live?.ports.length
          ? ` While it runs, ${live.ports.map((each) => `port ${each.port} is shown at ${each.address}`).join(", ")}: give the person that address.`
          : ""
      }`,
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
        ? `ran longer than ${Math.round(input.timeoutMs / 1000)} s and was stopped with everything it started.`
        : result.ending === "outputLimit"
          ? "printed more than a command may and was stopped with everything it started."
          : result.ending === "stopped"
            ? "was stopped with everything it started."
            : `finished with exit code ${result.exitCode}.`,
  };
}

/** A path refused the shell, as busybox, Windows and the common runtimes say it. */
const refusedPath = /Permission denied|Access is denied|EACCES|EPERM/;

const askForMore =
  "This command ran sealed off: it reads the workspace, Zhiyin's tools, Windows' own files and the folders granted, and changes the workspace and the folders granted for changing. If it needs a folder or a website more, ask with request_access. A program installed where Windows lets no container read it, as in Program Files when its installer gave no access to app containers, cannot be granted: run it with full_access, which the person approves. So does a program that opens NUL itself, or needs the person's own profile.";

/**
 * A sealed-off command's answer, with what the container kept from it said
 * to the model (ADR 0029): each host Zhiyin's proxy refused, by name, and,
 * for a refused path, how to ask for more. What any host sent makes the
 * answer outside content.
 */
function sealedResult(
  ran: { readonly result: ToolInvocationResult; readonly ending: string },
  run: ProcessRun,
  confined: SealedRun,
  live: LiveRun | undefined,
): { readonly result: ToolInvocationResult; readonly ending: string } {
  if (run.failure === "confinement")
    return {
      result: {
        ok: false,
        reason:
          `This command could not be sealed off, so it did not run. ${run.reason ?? ""} To run it anyway, run it with full_access: true, which the person approves.`.trim(),
      },
      ending: "could not be sealed off.",
    };
  const refusedHosts = [
    ...new Set([
      ...(run.network ?? [])
        .filter((reach) => reach.refused)
        .map((reach) =>
          reach.port === 443 ? reach.host : `${reach.host}:${reach.port}`,
        ),
      ...confined.tally.refusedHosts,
    ]),
  ];
  const received =
    confined.tally.received ||
    (run.network ?? []).some((reach) => reach.received > 0) ||
    (run.furtherHosts?.received ?? 0) > 0;
  const result = ran.result;
  const value =
    "value" in result && result.value && typeof result.value === "object"
      ? (result.value as Record<string, unknown>)
      : undefined;
  if (!value) return ran;
  const stderr = typeof value["stderr"] === "string" ? value["stderr"] : "";
  const notes = [
    ...(refusedHosts.length
      ? [
          `Zhiyin's proxy refused ${refusedHosts.join(", ")}: ${refusedHosts.length === 1 ? "it is" : "they are"} not on this conversation's list. Ask for a website with request_access if the work needs it.`,
        ]
      : []),
    ...(refusedPath.test(stderr) ? [askForMore] : []),
    ...confined.notes,
  ];
  const shown = live?.ports.length
    ? {
        ports: live.ports.map((each) => ({
          port: each.port,
          address: each.address,
        })),
      }
    : {};
  const withNotes = {
    ...value,
    ...(refusedHosts.length ? { refusedHosts } : {}),
    ...shown,
    ...(notes.length ? { sealedOff: notes.join(" ") } : {}),
  };
  return {
    // A job's ending is all the model is told of it unasked.
    ending: refusedHosts.length
      ? `${ran.ending} Zhiyin's proxy refused it ${refusedHosts.join(", ")}.`
      : ran.ending,
    result: {
      ...result,
      value: withNotes,
      ...(received ? { brings: "outside" as const } : {}),
    } as ToolInvocationResult,
  };
}

/**
 * How a job ended, for the conversation: why, what it changed in the
 * workspace by count, and where to read the rest.
 */
function endingSentence(
  why: string,
  run: ProcessRun,
  changes?: CommandFileChanges,
): string {
  const counted = changes ? changesCounted(changes) : undefined;
  const files = changes?.status === "checked" && counted !== noChange;
  const read =
    run.ending === "stopped" || run.failure
      ? ""
      : files
        ? " Read what it printed and which files changed with job_output."
        : " Read what it printed with job_output.";
  return `${why}${counted ? ` ${counted}` : ""}${read}`;
}

const noChange = "It changed no file in the workspace.";

/** What a command changed in the workspace, counted by kind. */
function changesCounted(changes: CommandFileChanges): string | undefined {
  if (changes.status === "running") return undefined;
  if (changes.status === "unchecked")
    return `Its changes to files were not checked: ${changes.reason}`;
  const count = (kind: CommandFileChange["change"]) =>
    changes.files.filter((file) => file.change === kind).length;
  const parts = [
    [count("created"), "created"],
    [count("updated"), "changed"],
    [count("deleted"), "removed"],
  ]
    .filter(([n]) => n)
    .map(([n, word]) => `${n} ${word}`);
  if (!parts.length && !changes.more) return noChange;
  const more = changes.more ? `, and ${changes.more} more changes` : "";
  return `Files in the workspace: ${parts.join(", ")}${more}.`;
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
    ) ||
    // busybox's shell says it its own way.
    /^sh: (?:line \d+: )?[^:\n]+: not found\s*$/m.test(err.text)
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

/** What running commands needs from the application. */
export type RunCommandNeeds = {
  /** The shell commands run in; the tool is withdrawn while there is none. */
  readonly shell: CommandShell;
  readonly containment: CommandContainment | undefined;
  readonly items: ConversationItems | undefined;
  readonly jobs: CommandJobs;
  readonly files: ListingSetup;
  readonly promoteAfterMs: number | undefined;
  /** What each conversation granted its sealed-off commands. */
  readonly reach: ConversationReach | undefined;
};

/** The shell command tool, as the registry offers it. */
export function runCommandTool({
  shell,
  containment,
  items,
  jobs,
  files,
  promoteAfterMs,
  reach,
}: RunCommandNeeds): ToolDefinition {
  /** Whether a call runs sealed off, and with what it reaches. */
  const sealedFor = async (conversationId: string | undefined) => {
    const use = await shell.checkedUse();
    const sealed = shell.sealed;
    if (!use.sealed || !sealed || !conversationId) return undefined;
    const granted = reach?.(conversationId) ?? nothingGranted;
    return { sealed, reach: granted, hosts: sealed.hosts(granted) };
  };
  return {
    // Its description says whether commands run sealed off here, and why not.
    get spec(): ToolSpec {
      return {
        ...runCommandSpec,
        description: descriptionFor(shell.use(), shell.sealed !== undefined),
      };
    },
    requiresWorkspace: true,
    requiresShell: true,
    inspect: async (args, conversationId) =>
      inspectRunCommand(args, await sealedFor(conversationId)),
    execute: async (args, signal, conversationId, { root }) => {
      const sealed = await sealedFor(conversationId);
      const input = commandArguments(args);
      return runShellCommand(shell.path as string, root, args, {
        signal,
        containment,
        ...(sealed && input && !input.fullAccess
          ? {
              sealed: (stop: AbortSignal) =>
                sealed.sealed.run(
                  input.command,
                  root,
                  conversationId as string,
                  sealed.reach,
                  stop,
                  commandEnvironment(),
                ),
            }
          : {}),
        context: {
          ...(conversationId ? { conversationId } : {}),
          ...(items ? { items } : {}),
          jobs,
          files,
          ...(promoteAfterMs === undefined ? {} : { promoteAfterMs }),
        },
      });
    },
  };
}
