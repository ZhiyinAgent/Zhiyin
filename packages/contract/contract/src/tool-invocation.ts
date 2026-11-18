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
   * The value is written in words for a person — "2000 × 2000 pixels" — by a
   * tool Zhiyin ships, not passed on as data. Drawn as text, not as code.
   */
  readonly readable?: true;
  /**
   * The input is a command that runs as written, said by a tool Zhiyin ships.
   * Drawn as the command itself. A connector never sets it, whatever its tool
   * is called.
   */
  readonly runs?: true;
  /**
   * Characters missing from the middle of `value`, in a record that holds
   * the value cut. Both ends are kept: the start says what a value is, and
   * the end says where it stops.
   */
  readonly omitted?: number;
};

/**
 * How a tool reports what it did, in shapes an interface can draw.
 *
 * A tool knows what its own result means; nothing else does. Left to infer,
 * the interface would have to switch on tool names — which is the same mistake
 * as trusting a name for authority (ADR 0012), one layer up: a remote tool
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
   * Whether each of a set of conditions holds, as the tool measured it: the
   * verdict the person reads comes from the tool, not from the model's
   * account of it.
   */
  | {
      readonly kind: "checks";
      readonly label: string;
      readonly items: readonly {
        readonly label: string;
        /** Null when it could not be checked. */
        readonly holds: boolean | null;
        /** What was measured, or why it could not be. */
        readonly note?: string;
      }[];
      /** What the list leaves out that the person should know. */
      readonly note?: string;
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
      /**
       * Said to the model by Zhiyin, not the tool: what a sealed-off program
       * could only read for its run, and why, when the run may have been
       * refused a write to it (ADR 0012).
       */
      readonly heldForRun?: string;
      /** What the person sees beside the conversation of what this action did. */
      readonly shown?: string;
      /** The link to cite the document this action read with (ADR 0019). */
      readonly cite?: string;
      /**
       * What it returned is outside content, found only once it ran, as the
       * lines a search shows from a downloaded file are (ADR 0012). It can
       * only add to what the conversation holds, never take away.
       */
      readonly brings?: "outside";
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
      /** As on a success: what the program could only read for its run. */
      readonly heldForRun?: string;
      /** The files an action wrote before it failed. */
      readonly produced?: readonly ProducedFile[];
      /**
       * What the person sees beside the conversation: a document whose read
       * failed is still shown, with the same failure (ADR 0019).
       */
      readonly shown?: string;
    };

/**
 * What an action does, declared whole by the code that carries it out (ADR
 * 0012). Every part is said, "none" included, so a tool cannot leave one out.
 */
export type ActionEffects = {
  /**
   * Where it reads: the workspace, Zhiyin's own records, elsewhere on this
   * computer, or the person's account on a service, which may hold what is
   * private to them.
   */
  readonly reads: "none" | "workspace" | "app" | "elsewhere" | "account";
  /**
   * What it changes: Zhiyin's own records, such as a Python environment; the
   * workspace, with Zhiyin able to put back what it changed; for good, a
   * change Zhiyin cannot put back wherever it is, as a deletion that skips
   * the Recycle Bin, a file too large to back up or a folder that could not
   * be copied; or elsewhere on this computer.
   */
  readonly changes:
    "none" | "app" | "workspace" | "workspace-for-good" | "elsewhere";
  /**
   * Where what it sends off this computer goes: a fixed service the person
   * connected, which the model does not choose, or a destination the model
   * chose, carrying what the model wrote.
   */
  readonly sends: "none" | "service" | "chosen";
  /**
   * Whether it acts as the person on an account others see: in a way that can
   * be taken back, or for good, as publishing or deleting is.
   */
  readonly actsAsPerson: "none" | "once" | "for-good";
  /** The code it runs: sealed off from all but what it is given, or with the person's full access. */
  readonly runs: "none" | "sealed" | "full-access";
  /** Whether it leaves something that runs later without anyone starting it. */
  readonly lasting: boolean;
  /**
   * Whether what it returns is outside content: written by someone other than
   * the person or Zhiyin, as a web page, a search result or a file downloaded
   * from the internet is. The model may be steered by it.
   */
  readonly brings: "none" | "outside";
  /**
   * For a send to a destination the model chose, what reaches it, when that
   * is not words of the model's: the destination's address alone, as opening
   * a page sends; or nothing the model wrote, as a click on the open page
   * sends. Absent, what is sent may hold anything the model wrote.
   */
  readonly carries?: "address" | "nothing";
  /**
   * Where an action that acts as the person lands, such as a repository: a
   * grant for the conversation is bound to it.
   */
  readonly destination?: string;
  /**
   * For a change for good, the files it changes that Zhiyin could not copy,
   * by their whole real paths, when that is all it cannot put back: a grant
   * for the conversation may cover each file (ADR 0013). Said by the agent
   * loop from what was copied, never by a tool.
   */
  readonly uncopied?: readonly string[];
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
      /**
       * Said by the implementation that builds `identity`: it holds this
       * call's own inputs, so allowing the call for the conversation allows
       * only this same call again, not the tool.
       */
      readonly boundToCall?: true;
      /**
       * Said by a built-in connection: a set of its calls this one belongs to,
       * which it vouches for, named by a key every call in the set carries.
       * Allowing this call for the conversation then allows each of them.
       */
      readonly allowance?: Readonly<{ key: string; label: string }>;
      /**
       * Said by the code that owns the tool: this call is asked about every
       * time, whatever its effects, and no grant for the conversation covers
       * it (ADR 0012).
       */
      readonly asksEachTime?: true;
      /**
       * Every place what the call sends goes, as a person recognises each:
       * an endpoint, or a service and the mirrors it falls back to.
       */
      readonly destinations?: readonly string[];
      /**
       * The connection a connector call belongs to, named by the app. Apart
       * from `target`, which may be a page or an address the call acts on.
       */
      readonly connection?: string;
      /**
       * Set by the connection feature, never by a connection: the id of the
       * connection the call goes to. A grant across a connection's tools is
       * bound to it.
       */
      readonly connectionId?: string;
      /**
       * What every file this action would change looks like before and after.
       * Only a tool that knows its effects exactly can offer this; a shell
       * command cannot, and says nothing here rather than guessing.
       */
      readonly changes?: readonly FileChange[];
      /**
       * Said by the code that owns the tool: the call runs a program that may
       * change any file in the workspace, naming none (ADR 0012), and in each
       * folder `outside` names, by its real path. Each folder is copied
       * before it runs and what it changed is recorded, so going back puts
       * each file back. A sealed-off program is also kept, for its run,
       * from changing Git's folder and Startup folders, and what could not
       * be copied: all but the files `writable` names, in the workspace by
       * their path there and elsewhere by their whole path, which its
       * approval names, and which the input `unheldBy` names a later call
       * can give. `saves` names, by their path in the workspace, the files
       * the program changes whatever it does, as Blender saves its scene:
       * one Zhiyin could not copy is left writable, and its approval names
       * it as changed without a copy (ADR 0013).
       */
      readonly changesAnyFile?: Readonly<{
        writable: readonly string[];
        unheldBy?: string;
        outside?: readonly string[];
        saves?: readonly string[];
      }>;
      /**
       * Set by the connection feature, never by a connection: the call goes to
       * a connection Zhiyin ships, so its `changes` are known exactly and can
       * be backed up, as a built-in tool's are, and its declared reads inside
       * the workspace are trusted as a built-in tool's (ADR 0012).
       */
      readonly builtInConnection?: true;
      /**
       * Said by a built-in tool: each file its `changes` name outside the
       * workspace is the whole of what it changes there, so a grant for that
       * file or its folder can cover the call (ADR 0012).
       */
      readonly grantableByFile?: true;
      /**
       * What the action does, said by the code that carries it out: the one
       * description of what it reads and changes, and whether that stays
       * inside the workspace, computed by the code that enforces the
       * containment. Nothing downstream re-derives it from `target`. Trusted
       * only from a built-in tool or a connection Zhiyin ships; absent, the
       * action is decided as the worst it could do.
       */
      readonly effects?: ActionEffects;
      /**
       * Set by the connection feature, never by a connection: the call's
       * `effects` come from a built-in plugin's manifest, which Zhiyin
       * wrote, so they are trusted as a shipped connection's are. Nothing
       * else about the call is.
       */
      readonly effectsDeclaredByZhiyin?: true;
      /**
       * Set by the connection feature from Settings, never by a connection:
       * what the person said of this tool of a connection Zhiyin does not
       * ship, that it only reads or that it asks every time (ADR 0012).
       */
      readonly personSays?: "only-reads" | "ask-each-time";
      /** Only built-in inert display tools may opt out of permission. */
      readonly requiresApproval?: false;
      /** Source to check in the renderer before this tool is allowed to run. */
      readonly view?: ProducedView;
      /** A bounded built-in question set that waits for a person's answer. */
      readonly input?: UserInputRequest;
      /**
       * The workspace document this call reads, and the first page it reads,
       * to be shown beside the conversation (ADR 0019). Set only by the tool
       * that reads documents, only for a file inside the workspace.
       */
      readonly document?: Readonly<{ path: string; page?: number }>;
      /**
       * The call closes the document shown beside the conversation. Set only
       * by the tool that does that.
       */
      readonly closesDocument?: true;
      /**
       * The workspace files this call reads as text, by the paths it was
       * given, so a condensed conversation can read them again. Set only by
       * the tools that read files.
       */
      readonly readsText?: readonly string[];
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
    };
