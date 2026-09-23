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

import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { runProcess, type ProcessContainment } from "@zhiyin/process-ownership";
import type {
  ShellAvailability,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";
import { detailsOf, facts, textDetail } from "./action-detail.js";
import { describeCommand } from "./workspace-path.js";

/**
 * Containment for one command's process tree, supplied by the application.
 * The platform owns the mechanism; this feature owns shell policy and wording.
 */
export type CommandContainment = ProcessContainment;
export type CommandContainer = ReturnType<ProcessContainment["open"]>;

const defaultTimeoutMs = 120_000;
const maximumTimeoutMs = 600_000;
const maximumOutputCharacters = 100_000;
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
 * Candidate locations for a real bash, in the order they are trusted. An
 * explicit setting wins; otherwise the Git for Windows shells, which are what
 * `bash` means on an ordinary Windows machine.
 */
function bashCandidates(environment: NodeJS.ProcessEnv): string[] {
  const configured = environment["ZHIYIN_BASH"];
  const programFiles = [
    environment["ProgramFiles"],
    environment["ProgramW6432"],
    environment["ProgramFiles(x86)"],
    environment["LOCALAPPDATA"],
  ].filter((value): value is string => Boolean(value));
  const fromPath = (environment["PATH"] ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((entry) => [join(entry, "bash.exe"), join(entry, "bash")]);
  return [
    ...(configured ? [configured] : []),
    ...programFiles.flatMap((base) => [
      join(base, "Git", "bin", "bash.exe"),
      join(base, "Git", "usr", "bin", "bash.exe"),
      join(base, "Programs", "Git", "bin", "bash.exe"),
    ]),
    ...fromPath,
  ];
}

/**
 * Resolved once, when the tool registry is built: a shell that is not present
 * is a capability that does not exist, and a capability that does not exist is
 * never advertised to the model.
 */
export function resolveShell(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const candidate of bashCandidates(environment)) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** The one unavailable reading, so a caller can report it without re-probing. */
export const shellUnavailable: ShellAvailability = {
  available: false,
  reason:
    "No shell was found. Zhiyin runs shell commands through the bash that ships with Git for Windows.",
  installUrl: "https://git-scm.com/download/win",
};

/**
 * The same detection `resolveShell` uses, reported for a person rather than
 * silently folded into whether the `bash` tool exists. Queried live — no
 * caching here — so asking again after an install is enough to pick it up.
 */
export function shellAvailability(
  environment: NodeJS.ProcessEnv = process.env,
): ShellAvailability {
  return resolveShell(environment) ? { available: true } : shellUnavailable;
}

export const runCommandSpec: ToolSpec = {
  name: "bash",
  description:
    "Run one bash command starting in the current workspace folder. Use it for work no other tool covers, such as running a build, a test suite, or a version-control command. It is not confined to the workspace: it can access anything the user's account can access, reach the network, and start programs, so it always requires a person's approval.",
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
        description: `How long to let it run before stopping it. Defaults to ${defaultTimeoutMs} ms.`,
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

function boundedOutput(value: string): {
  readonly text: string;
  readonly truncated: boolean;
} {
  if (value.length <= maximumOutputCharacters)
    return { text: value, truncated: false };
  const marker = "\n… output shortened …\n";
  const edge = Math.floor((maximumOutputCharacters - marker.length) / 2);
  return {
    text: `${value.slice(0, edge)}${marker}${value.slice(-edge)}`,
    truncated: true,
  };
}

export function inspectRunCommand(
  workspaceName: string,
  args: unknown,
): ToolCallInspection {
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
  return {
    ok: true,
    action: "Run a shell command",
    target: shortened(input.command, shownCommandLength),
    // Authoritative: true of every command, whatever the model says about
    // this one.
    detail: `This starts in ${workspaceName} but is not confined to that folder. It can read, change, or delete any files your account can access, reach the network, and start other programs. It cannot be undone.`,
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
  if (signal?.aborted) {
    return {
      ok: false,
      reason: "The command was stopped before it started.",
    };
  }

  const started = Date.now();
  const result = await runProcess({
    executable: shell,
    arguments: ["-c", input.command],
    cwd: root,
    timeoutMs: input.timeoutMs,
    ...(signal ? { signal } : {}),
    ...(containment ? { containment } : {}),
    maximumOutputCharacters: maximumOutputCharacters * 4,
  });
  if (result.failure === "containment") {
    return {
      ok: false,
      reason:
        "This command was not started, because the processes it creates could not be contained.",
    };
  }
  return commandResult({
    command: input.command,
    started,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    ending: result.ending,
    failure: result.failure === "start" ? new Error("start failed") : undefined,
    timeoutMs: input.timeoutMs,
  });
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
}): ToolInvocationResult {
  const out = boundedOutput(input.stdout);
  const err = boundedOutput(input.stderr);
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
