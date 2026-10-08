import type { CommandFileChanges, FileChange } from "./file-change.js";
import type { ProducedImage } from "./pictures.js";
import type { UserInputRequest } from "./user-input.js";
import type { ProducedView } from "./views.js";

/**
 * A workspace file an action created or replaced. A tool declares what it
 * changed; nothing downstream has to guess from a tool's name or its result
 * shape which actions produce files.
 */
export type ProducedFile = {
  /** Workspace-relative, forward-slashed. */
  readonly path: string;
  readonly change: "created" | "updated";
  readonly bytes: number;
};

/**
 * A tool call as a person should read it: what was called, and with what.
 *
 * Carried as structure rather than as a rendered string, because the interface
 * has to lay the arguments out and a rendered call can only be taken apart
 * again by guessing — the first value containing a bracket or a quote defeats
 * any parser written against it.
 */
export type ToolInvocation = {
  /** The tool as the person should see it, without routing prefixes. */
  readonly name: string;
  /** Where the call goes, when that is not this machine. */
  readonly via?: string;
  readonly arguments: readonly ToolArgument[];
};

export type ToolArgument = {
  readonly name: string;
  /**
   * What this input is for, taken from the schema the tool declares.
   *
   * Written by whoever runs the tool, not by this app, and therefore a claim
   * rather than anything established here - a server is free to describe
   * `delete_everything` as listing files. Shown as the server's words, in the
   * same way `claim` is shown as the model's.
   */
  readonly described?: string;
  /** The value as JSON text. Formatted and coloured where it is drawn. */
  readonly value: string;
  /**
   * Characters removed from the middle of `value`, when it was too long to
   * carry whole. Both ends are kept: the start says what a value is, and the
   * end says where it stops.
   */
  readonly omitted?: number;
};

/**
 * How a tool reports what it did, in shapes an interface can draw.
 *
 * A tool knows what its own result means; nothing else does. Left to infer,
 * the interface would have to switch on tool names — which is the same mistake
 * as trusting a name for authority (ADR 0006), one layer up: a remote tool
 * calling itself `search_files` would inherit the drawing as well as the
 * trust. So the tool says which of a few plain shapes its answer takes, and
 * the interface knows only the shapes.
 *
 * Deliberately few. This is a vocabulary for showing an answer to a person,
 * not a layout language, and a tool that needs something outside it should
 * say nothing rather than force a shape — an unadorned result is honest, a
 * wrong one is not.
 */
export type ActionDetail =
  /** A run of text: a file's contents, a command's output. */
  | {
      readonly kind: "text";
      readonly label: string;
      readonly text: string;
      readonly truncated?: boolean;
    }
  /** Short named values: an exit code, a count, a size. */
  | {
      readonly kind: "facts";
      readonly items: readonly {
        readonly label: string;
        readonly value: string;
      }[];
    }
  /** Where something was found. */
  | {
      readonly kind: "matches";
      readonly items: readonly {
        readonly path: string;
        readonly line: number;
        readonly text: string;
      }[];
      readonly truncated?: boolean;
      /** What the answer does not cover, when it does not cover everything. */
      readonly note?: string;
    }
  /** Names, as a list: the entries of a folder. */
  | {
      readonly kind: "list";
      readonly label: string;
      readonly items: readonly string[];
      readonly truncated?: boolean;
    }
  /**
   * A picture the action produced, shown as itself.
   *
   * The picture is named, not carried: a conversation's saved state is
   * rewritten whenever anything in it changes, and a megabyte of encoded
   * image inside that file would be rewritten with it. `source` names a
   * picture the application stored, read back on demand.
   */
  | {
      readonly kind: "image";
      readonly label: string;
      readonly mediaType: string;
      /** Opaque id of a stored picture, never a path. */
      readonly source: string;
      /** What the picture is of, for anyone not looking at it. */
      readonly alt: string;
    };

export type ToolInvocationResult =
  | {
      readonly ok: true;
      readonly value: unknown;
      readonly produced?: readonly ProducedFile[];
      readonly view?: ProducedView;
      /**
       * Pictures this action produced. Only a model that accepts images is
       * ever sent them; for any other, the action answers in words that it
       * cannot show the model a picture.
       */
      readonly images?: readonly ProducedImage[];
      /**
       * The answer as the tool would have a person read it. Absent when the
       * tool has nothing better to offer than what it returned to the model.
       */
      readonly details?: readonly ActionDetail[];
      /** What changed in the folder while a shell command ran. */
      readonly commandChanges?: CommandFileChanges;
      /** What the person sees beside the conversation of what this action did. */
      readonly shown?: string;
      /** The link to cite the document this action read with (ADR 0018). */
      readonly cite?: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      /**
       * What was observed even though the action failed — the output of a
       * command that exited non-zero, for instance. A failure is still a
       * failure; this keeps the evidence of what happened.
       */
      readonly value?: unknown;
      /**
       * True when the action itself ran to completion and `reason` describes
       * what it reported, rather than something that stopped it from running.
       * A command that exits non-zero has reported; one that could not be
       * started, was stopped, or timed out has not.
       *
       * The model is told the same thing either way — this is not success. The
       * distinction exists so a person is not shown a failure marker for an
       * action that did exactly what it was asked to do and came back with an
       * answer they can act on.
       */
      readonly reported?: boolean;
      /** What it did report, when it reported something worth reading. */
      readonly details?: readonly ActionDetail[];
      /** A command that failed may still have changed files before it did. */
      readonly commandChanges?: CommandFileChanges;
      /**
       * What the person sees beside the conversation: a document whose read
       * failed is still shown, with the same failure (ADR 0018).
       */
      readonly shown?: string;
    };

export type ToolCallInspection =
  | {
      readonly ok: true;
      readonly action: string;
      readonly target: string;
      readonly command: string;
      readonly invocation?: ToolInvocation;
      /**
       * Exact interface copy supplied by an implementation the app owns.
       * Remote tools cannot provide this; their purpose remains model-written
       * and attributed as such.
       */
      readonly presentation?: Readonly<{ title: string; description: string }>;
      /**
       * One plain sentence naming the consequence the action string alone does
       * not carry — that a file is replaced rather than created, or how many
       * files an edit touches. Shown with the permission request.
       */
      readonly detail?: string;
      /**
       * An explanation supplied by the model, never verified. Kept apart from
       * `detail` so an unverified claim can never be shown as an established
       * consequence.
       */
      readonly claim?: string;
      readonly identity?: string;
      readonly destination?: string;
      /**
       * The connection a connector call belongs to, named by the app. Apart
       * from `target`, which may be a page or an address the call acts on.
       */
      readonly connection?: string;
      /**
       * What the action does to durable state, declared by the implementation
       * that will carry it out. Absent means no claim was made, and no claim
       * is read as a change: a tool that does not say it only reads does not
       * get treated as though it had.
       */
      readonly access?: "read" | "change";
      /**
       * Whether the action stays inside the selected workspace, computed by
       * the implementation that enforces the containment. Nothing downstream
       * may re-derive this from `target` — a second containment predicate is a
       * second boundary to keep in sync with the one that actually holds.
       */
      readonly scope?: "workspace" | "outside";
      /**
       * What every file this action would change looks like before and after.
       * Only a tool that knows its effects exactly can offer this; a shell
       * command cannot, and says nothing here rather than guessing.
       */
      readonly changes?: readonly FileChange[];
      /**
       * Set by the connection feature, never by a connection: the call goes to
       * a connection Zhiyin ships, so its `changes` are known exactly and can
       * be backed up, as a built-in tool's are. Its approval is unaffected.
       */
      readonly builtInConnection?: true;
      /** Only built-in inert display tools may opt out of permission. */
      readonly requiresApproval?: false;
      /** Source to check in the renderer before this tool is allowed to run. */
      readonly view?: ProducedView;
      /** A bounded built-in question set that waits for a person's answer. */
      readonly input?: UserInputRequest;
      /**
       * The workspace document this call reads, and the first page it reads,
       * to be shown beside the conversation (ADR 0018). Set only by the tool
       * that reads documents, only for a file inside the workspace.
       */
      readonly document?: Readonly<{ path: string; page?: number }>;
      /**
       * The call closes the document shown beside the conversation. Set only
       * by the tool that does that.
       */
      readonly closesDocument?: true;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      /**
       * True when the model can fix this itself by proposing a better call —
       * a pattern that did not match, an ambiguous request, a path that does
       * not exist. A caller may retry such a failure quietly instead of
       * spending a person's attention on it. Never set for a refusal that a
       * person should see, such as an attempt to leave the workspace.
       */
      readonly correctable?: boolean;
      /**
       * Argument field names whose values any attempted repair must carry
       * through unchanged, matched wherever they appear in the arguments.
       *
       * A repair is allowed to fix how an action is *aimed* — which file, which
       * occurrence, how the text to find is written. It is never allowed to
       * change what the action would *write*, because that is the part nobody
       * else proposed. The tool names those fields because only the tool knows
       * which of its arguments carry content.
       */
      readonly preserveOnRepair?: readonly string[];
    };
