/**
 * Commands that outlast the call that started them, kept as jobs of their
 * conversation.
 *
 * An install, a build or a conversion can take far longer than anyone should
 * wait on one tool call, and killing it at a deadline throws the work away.
 * So a command still running when it was due to answer carries on as a job:
 * the call answers with what it has printed so far, and the model can look
 * again, wait for it, or stop it. The job stays in the container it was
 * started in, so it still ends with Zhiyin however Zhiyin ends.
 *
 * A job belongs to its conversation, not to the turn that started it: the
 * turn may end while the job runs. Stopping the conversation, deleting it, or
 * closing Zhiyin stops its jobs. A job that ends by itself is announced, so a
 * conversation whose turn has ended can be woken to report on it. One the
 * model stops is not, because it already knows; one the person stops is told
 * to the model at its next request, without waking it, since there is nothing
 * to report on.
 *
 * The person sees a conversation's running jobs and what they have printed,
 * and whoever shows them is told when that list changes.
 */

import type {
  CommandFileChanges,
  CommandOutput,
  RunningCommand,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
} from "@zhiyin/contract";

/** Running jobs one conversation may have; a further command runs to its end. */
const maximumRunning = 3;
const maximumWaitSeconds = 600;

/**
 * A job ended, said in a sentence for the conversation. `wakes` is false when
 * the conversation need only hear it at its next request.
 */
export type CommandEnded = (
  conversationId: string,
  notice: string,
  wakes: boolean,
) => void;

/** A conversation's running jobs changed: one started or one ended. */
export type CommandsChanged = (conversationId: string) => void;

/** What changed in the folder while a job ran, once it has ended. */
export type JobChanges = (
  conversationId: string,
  job: string,
  changes: CommandFileChanges,
) => void;

type Job = {
  readonly id: string;
  readonly command: string;
  readonly explanation: string;
  readonly started: number;
  readonly stop: () => void;
  readonly printed: () => Promise<{ stdout: string; stderr: string }>;
  /** The command's own answer once it ends, however it ends. */
  readonly outcome: Promise<ToolInvocationResult>;
  /** Why it ended, in a sentence for the conversation, once it has. */
  readonly ending: Promise<string>;
  /** What changed in its folder, once it has ended, when that was looked at. */
  readonly changes: Promise<CommandFileChanges | undefined>;
  ended: boolean;
  stopping: boolean;
};

export type AdoptedCommand = Omit<Job, "id" | "ended" | "stopping">;

export const jobOutputSpec: ToolSpec = {
  access: "read",
  name: "job_output",
  description: `See what a command that became a job has printed, and whether it is still running. Give waitSeconds to wait for it to end first, up to ${maximumWaitSeconds}; the answer comes as soon as it ends. You are also told when a job ends by itself, so there is no need to keep asking.`,
  inputSchema: {
    type: "object",
    properties: {
      job: { type: "string", description: 'The job, such as "J1".' },
      waitSeconds: {
        type: "integer",
        minimum: 0,
        maximum: maximumWaitSeconds,
        description: "How long to wait for it to end. Defaults to 0.",
      },
    },
    required: ["job"],
    additionalProperties: false,
  },
};

/*
 * Declared a read: stopping a process this conversation started and the
 * person already approved writes nothing of its own. Whatever the command had
 * done stays done, and the answer says so.
 */
export const stopJobSpec: ToolSpec = {
  access: "read",
  name: "stop_job",
  description:
    "Stop a command that became a job, with everything it started. What it already did is not undone.",
  inputSchema: {
    type: "object",
    properties: {
      job: { type: "string", description: 'The job, such as "J1".' },
    },
    required: ["job"],
    additionalProperties: false,
  },
};

type JobArguments = { readonly job: string; readonly waitSeconds: number };

function jobArguments(args: unknown, waits: boolean): JobArguments | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const source = args as Record<string, unknown>;
  const allowed = waits ? ["job", "waitSeconds"] : ["job"];
  if (Object.keys(source).some((key) => !allowed.includes(key))) return;
  const job = source["job"];
  if (typeof job !== "string" || !/^J\d+$/i.test(job.trim())) return;
  const waitSeconds = source["waitSeconds"] ?? 0;
  if (
    !Number.isInteger(waitSeconds) ||
    Number(waitSeconds) < 0 ||
    Number(waitSeconds) > maximumWaitSeconds
  )
    return;
  return { job: job.trim().toUpperCase(), waitSeconds: Number(waitSeconds) };
}

export function inspectJobCall(
  name: string,
  args: unknown,
): ToolCallInspection {
  const input = jobArguments(args, name === jobOutputSpec.name);
  if (!input)
    return {
      ok: false,
      reason:
        name === jobOutputSpec.name
          ? `Name a job, such as "J1", and optionally how many seconds to wait, up to ${maximumWaitSeconds}.`
          : 'Name a job, such as "J1".',
      correctable: true,
    };
  return {
    ok: true,
    action:
      name === jobOutputSpec.name ? "Look at a running command" : "Stop a job",
    target: input.job,
    access: "read",
    scope: "workspace",
    command: `${name}(${JSON.stringify(input)})`,
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}

export class CommandJobs {
  readonly #byConversation = new Map<string, Map<string, Job>>();
  readonly #numbered = new Map<string, number>();
  readonly #listeners = new Set<CommandEnded>();
  readonly #watchers = new Set<CommandsChanged>();
  readonly #changeWatchers = new Set<JobChanges>();
  /**
   * Set once Zhiyin is closing. The jobs it stops then are not announced as
   * changed: whoever keeps the list keeps it as it was, so the conversation
   * can be told after a restart that they were stopped.
   */
  #closing = false;

  onEnded(listener: CommandEnded): void {
    this.#listeners.add(listener);
  }

  onChanged(watcher: CommandsChanged): void {
    this.#watchers.add(watcher);
  }

  onJobChanges(watcher: JobChanges): void {
    this.#changeWatchers.add(watcher);
  }

  #announce(conversationId: string, notice: string, wakes: boolean): void {
    for (const listener of this.#listeners)
      listener(conversationId, notice, wakes);
  }

  #changed(conversationId: string): void {
    if (this.#closing) return;
    for (const watcher of this.#watchers) watcher(conversationId);
  }

  /** Whether this conversation may have one more running job. */
  hasRoom(conversationId: string): boolean {
    const jobs = this.#byConversation.get(conversationId);
    return (
      [...(jobs?.values() ?? [])].filter((job) => !job.ended).length <
      maximumRunning
    );
  }

  /** Keeps a running command as a job of this conversation, and names it. */
  adopt(conversationId: string, command: AdoptedCommand): string {
    const number = (this.#numbered.get(conversationId) ?? 0) + 1;
    this.#numbered.set(conversationId, number);
    const id = `J${number}`;
    const job: Job = { ...command, id, ended: false, stopping: false };
    const jobs = this.#byConversation.get(conversationId) ?? new Map();
    jobs.set(id, job);
    this.#byConversation.set(conversationId, jobs);
    // Marked before anyone awaiting the outcome resumes, so they see it ended.
    void command.outcome.then(() => {
      job.ended = true;
      this.#changed(conversationId);
    });
    void command.ending.then((why) => {
      if (job.stopping) return;
      this.#announce(
        conversationId,
        `Job ${id} (${command.command}) ${why}`,
        true,
      );
    });
    // However it ended. Not once Zhiyin is closing: the conversation is
    // settled after the restart instead.
    void command.changes.then((changes) => {
      if (!changes || this.#closing) return;
      const named =
        changes.status === "checked" ? { ...changes, job: id } : changes;
      for (const watcher of this.#changeWatchers)
        watcher(conversationId, id, named);
    });
    this.#changed(conversationId);
    return id;
  }

  /** This conversation's jobs still running, oldest first. */
  running(conversationId: string): readonly RunningCommand[] {
    return [...(this.#byConversation.get(conversationId)?.values() ?? [])]
      .filter((job) => !job.ended)
      .map((job) => ({
        id: job.id,
        command: job.command,
        explanation: job.explanation,
        startedAt: job.started,
      }));
  }

  /** What a running job has printed so far; nothing once it has ended. */
  async printed(
    conversationId: string,
    id: string,
  ): Promise<CommandOutput | undefined> {
    const job = this.#find(conversationId, id);
    if (!job || job.ended) return undefined;
    return job.printed();
  }

  /**
   * Stops a job because the person asked, with everything it started, and
   * tells the conversation so at its next request.
   */
  async stopForPerson(conversationId: string, id: string): Promise<void> {
    const job = this.#find(conversationId, id);
    if (!job || job.ended) return;
    job.stopping = true;
    job.stop();
    await job.outcome;
    this.#announce(
      conversationId,
      `Job ${id} (${job.command}) was stopped by the person. What it printed can still be read with job_output.`,
      false,
    );
  }

  async output(
    conversationId: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<ToolInvocationResult> {
    const inspected = inspectJobCall(jobOutputSpec.name, args);
    const input = jobArguments(args, true);
    if (!inspected.ok || !input) return inspected as ToolInvocationResult;
    const job = this.#find(conversationId, input.job);
    if (!job) return missing(input.job);
    if (!job.ended && input.waitSeconds > 0)
      await Promise.race([
        job.outcome,
        delay(input.waitSeconds * 1000, signal),
      ]);
    return this.#answer(job);
  }

  async stop(
    conversationId: string,
    args: unknown,
  ): Promise<ToolInvocationResult> {
    const inspected = inspectJobCall(stopJobSpec.name, args);
    const input = jobArguments(args, false);
    if (!inspected.ok || !input) return inspected as ToolInvocationResult;
    const job = this.#find(conversationId, input.job);
    if (!job) return missing(input.job);
    if (!job.ended) {
      job.stopping = true;
      job.stop();
      await job.outcome;
    }
    return this.#answer(job);
  }

  /** Stops every job of a conversation, for one stopped, closed or deleted. */
  async stopAll(conversationId: string): Promise<void> {
    const jobs = [
      ...(this.#byConversation.get(conversationId)?.values() ?? []),
    ];
    for (const job of jobs) {
      if (job.ended) continue;
      job.stopping = true;
      job.stop();
    }
    await Promise.all(jobs.map((job) => job.outcome));
    this.#byConversation.delete(conversationId);
  }

  async stopEverything(): Promise<void> {
    this.#closing = true;
    await Promise.all(
      [...this.#byConversation.keys()].map((id) => this.stopAll(id)),
    );
  }

  #find(conversationId: string, id: string): Job | undefined {
    return this.#byConversation.get(conversationId)?.get(id);
  }

  async #answer(job: Job): Promise<ToolInvocationResult> {
    if (!job.ended) {
      const printed = await job.printed();
      return {
        ok: true,
        value: {
          job: job.id,
          status: "running",
          command: job.command,
          runningForSeconds: Math.round((Date.now() - job.started) / 1000),
          ...printed,
        },
      };
    }
    const outcome = await job.outcome;
    const status = job.stopping ? "stopped" : "finished";
    const value = {
      job: job.id,
      status,
      ...(outcome.ok || outcome.value !== undefined
        ? (outcome.value as Record<string, unknown>)
        : {}),
    };
    // Stopped on purpose, the stop is the answer asked for.
    if (job.stopping) {
      const { details } = outcome;
      return { ok: true, value, ...(details ? { details } : {}) };
    }
    // What the job changed belongs to the call that started it.
    const { commandChanges, ...answer } = outcome;
    void commandChanges;
    return { ...answer, value } as ToolInvocationResult;
  }
}

function missing(id: string): ToolInvocationResult {
  return {
    ok: false,
    reason: `There is no job ${id} in this conversation. A job stops when Zhiyin closes.`,
  };
}
