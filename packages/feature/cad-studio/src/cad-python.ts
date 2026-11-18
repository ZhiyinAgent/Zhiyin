/**
 * The Python the CAD studio builds parts with, as the composition root hands
 * it in: build123d in an environment Zhiyin keeps (ADR 0023). The studio says
 * what a run may read and write; whoever provides it confines the run to
 * that, offline.
 */

export type CadRun = {
  /** What Python is given: the harness first, then its request. */
  readonly arguments: readonly string[];
  readonly cwd: string;
  /** Folders it may read, beside its own Python. */
  readonly read: readonly string[];
  /** Folders it may change; nothing else. */
  readonly write: readonly string[];
  /** Its own home, which it may change too, and which goes with the run. */
  readonly home: string;
  /**
   * The home is this run's alone, removed by the studio after it, so what
   * Windows keeps for it in the person's profile goes when it ends.
   */
  readonly homeLastsOneRun?: boolean;
  readonly timeoutMs: number;
  /** The most it may print, across both streams, before it is stopped. */
  readonly maximumOutputBytes?: number;
  readonly signal?: AbortSignal;
};

export type CadRunOutcome =
  | {
      readonly ok: true;
      /** How the run went, once Python started. */
      readonly run: {
        /** Nothing when it was stopped or ran out of time. */
        readonly exitCode: number | null;
        readonly stdout: string;
        readonly stderr: string;
        /** Why it was ended early: it ran past its time, it was stopped, or it printed too much. */
        readonly ending?: "timeout" | "stopped" | "outputLimit";
      };
    }
  /** It did not run: Python could not be made, started or confined, and why. */
  | { readonly ok: false; readonly reason: string };

export type CadPython = {
  /**
   * Ready to run, or not able to run: not installed yet, made for an earlier
   * release, or without what makes it. Nothing here makes it (ADR 0023).
   */
  state(): Promise<"ready" | "unavailable">;
  run(request: CadRun): Promise<CadRunOutcome>;
};
