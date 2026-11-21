import type {
  ActionDetail,
  ActionEffects,
  CommandFileChanges,
  FileChange,
  ToolInvocation,
  MemoryChange,
  SetupSuggestion,
} from "./index.js";

export type ConversationPermission = {
  readonly id: string;
  readonly label: string;
  readonly at: string;
  readonly kind:
    | "connector-tool"
    | "outside-file"
    | "outside-folder"
    | "uncopied-file"
    | "destination"
    | "reach-host"
    | "reach-folder"
    | "reach-registries";
  /** A tool, or every tool of a connection, written `mcp__<server>__*`. */
  readonly toolName: string;
  /**
   * For a website sealed-off commands may reach (ADR 0029): the hosts it
   * covers, as a confinement names them, such as `example.com` and
   * `*.example.com`.
   */
  readonly hosts?: readonly string[];
  /**
   * The conversation's two facts (ADR 0012) as the card that made a grant
   * for sealed-off commands stated them (ADR 0029). A fact the card did not
   * cover asks for the grant to be confirmed before a command reaches it.
   */
  readonly facts?: Readonly<{
    outsideContent: boolean;
    privateWithinReach: boolean;
  }>;
  /** The package registries, declined when their confirmation was. */
  readonly declined?: true;
  /**
   * For a grant to sealed-off commands, the folder the conversation worked in
   * when it was made: it does not carry to another (ADR 0029).
   */
  readonly workspaceRoot?: string;
  /**
   * The real path of a folder outside the workspace, for changes in it; or,
   * for `reach-folder`, for sealed-off commands to read.
   */
  readonly folder?: string;
  /**
   * The real path of a file outside the workspace, for changes to it; or of
   * a file Zhiyin could not copy, for changes to it without a backup.
   */
  readonly file?: string;
  /**
   * A file changed without a backup, by its size and time of change as the
   * conversation last left it: a change made to it elsewhere since ends the
   * grant, so the person is asked again (ADR 0013).
   */
  readonly standing?: string;
  /**
   * Where actions of a connection that act as the person land, such as a
   * repository: the grant covers that destination and no other (ADR 0012).
   */
  readonly destination?: string;
  /**
   * The file's content as Zhiyin last wrote it: a change made to it
   * elsewhere since ends the grant, so the person is asked again.
   */
  readonly digest?: string;
  /**
   * Server and schema identity for one connector tool version; for every
   * tool of a connection, the allowance key its calls share.
   */
  readonly identity?: string;
};

export type ActionApproval = {
  readonly by:
    "you" | "conversation-permission" | "no-approval-needed" | "blocked";
  readonly at: string;
  readonly permissionId?: string;
  readonly label?: string;
  readonly reason?: string;
};

export type ActionRecovery = {
  readonly files: readonly {
    readonly path: string;
    readonly status: "protected" | "unprotected";
    readonly reason?: string;
  }[];
};

export type TaskAction = {
  readonly id: string;
  readonly action: string;
  readonly description?: string;
  /**
   * Who wrote the description: absent, Zhiyin's code; "model", the model's
   * account of the action, shown as its words.
   */
  readonly descriptionBy?: "model";
  readonly target: string;
  readonly command?: string;
  readonly toolName?: string;
  /** The workspace files the call read as text, as its inspection said. */
  readonly readText?: readonly string[];
  /** The model's call this action carried out, as its answer names it. */
  readonly callId?: string;
  readonly evidence?: string;
  readonly approval?: ActionApproval;
  readonly specialistRunId?: string;
  readonly changes?: readonly FileChange[];
  readonly details?: readonly ActionDetail[];
  readonly detail?: string;
  /** Model-written and unverified. */
  readonly claim?: string;
  readonly invocation?: ToolInvocation;
  /**
   * Set only when code the app wrote declared that this call reads and changes
   * nothing. Absent means it may have changed something.
   */
  readonly readOnly?: true;
  /** What it does, as the code that carries it out declared it (ADR 0012). */
  readonly effects?: ActionEffects;
  /**
   * What it brought into the conversation, kept so what the conversation
   * holds is worked out from its record (ADR 0012): outside content, which
   * may steer the model, and something private from beyond the workspace.
   */
  readonly brings?: "outside";
  readonly reachesPrivate?: true;
  /** For a `remember` call, the change it made to memory (ADR 0026). */
  readonly memory?: MemoryChange;
  /** For a `suggest_setup` call, the card it showed the person. */
  readonly setup?: SetupSuggestion;
  /**
   * A call the memory's look back over a turn made, after the turn's answer
   * (ADR 0026): kept in the record, shown only by what it kept.
   */
  readonly lookBack?: true;
  /** Which of the files it changes were copied first, so they can be put back. */
  readonly recovery?: ActionRecovery;
  /** What changed in the folder while a shell command ran; never put back. */
  readonly commandChanges?: CommandFileChanges;
  /** When it began running, after any approval. */
  readonly startedAt?: string;
  /** The conversation's folder when it began running. */
  readonly folder?: string;
  readonly finishedAt?: string;
  readonly sequence: number;
  readonly status:
    | "running"
    | "completed"
    | "reported"
    | "failed"
    | "denied"
    | "blocked"
    | "cancelled";
  readonly reason?: string;
};
