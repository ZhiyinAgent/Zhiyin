/**
 * The commands a conversation has carried on as jobs, as the person and the
 * rest of Zhiyin reach them: apart from the tool registry, which only offers
 * and runs the tools.
 */

import type {
  CommandFileChanges,
  CommandOutput,
  RunningCommand,
} from "@zhiyin/contract";

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

export interface ShellCommands {
  /**
   * Told when a conversation's command, carried on as a job, ends by itself,
   * or is stopped by the person.
   */
  onCommandEnded(listener: CommandEnded): void;
  /** Told when a conversation's running jobs change. */
  onCommandsChanged(watcher: CommandsChanged): void;
  /** Told what changed in the folder while a job ran, once it has ended. */
  onJobChanges(watcher: JobChanges): void;
  /** A conversation's running jobs, for the person to see. */
  runningCommands(conversationId: string): readonly RunningCommand[];
  /** What a running job has printed so far; nothing once it has ended. */
  commandOutput(
    conversationId: string,
    jobId: string,
  ): Promise<CommandOutput | undefined>;
  /** Stops a job because the person asked, and tells the conversation. */
  stopCommandForPerson(conversationId: string, jobId: string): Promise<void>;
  /** Stops a conversation's jobs, with everything they started. */
  stopCommands(conversationId: string): Promise<void>;
  /** Stops every conversation's jobs, as Zhiyin closes. */
  stopAllCommands(): Promise<void>;
}
