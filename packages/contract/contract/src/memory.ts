/**
 * What Zhiyin remembers across conversations, as the agent loop, the core
 * and the Memory page share it (ADR 0026). The memory feature keeps it in
 * Markdown files; everything here is how the rest of Zhiyin reads it.
 */

/**
 * Everything the person does, as a scope. A conversation outside any project
 * has a scope of its own (ADR 0026, memory-projects); any other scope is a
 * project's id.
 */
export const everythingScope = "everything";

/**
 * About the person and how to work are instructions; a brief is where a
 * project stands; knowledge is looked up when needed.
 */
export type MemorySection = "about" | "how" | "brief" | "knowledge";

/**
 * What a conversation held when it wrote an entry (ADR 0012), which a
 * conversation that reads the entry then holds too.
 */
export type MemoryHeld = {
  /** Outside content had entered it: a page, a download, a connector. */
  readonly outside?: true;
  /** It had reached something private beyond its folder. */
  readonly private?: true;
};

export type MemoryEntry = {
  /** Never changes and never reused, so a link to it stays right. */
  readonly number: number;
  /** `everythingScope`, a conversation's scope, or the id of its project. */
  readonly scope: string;
  readonly section: MemorySection;
  readonly title: string;
  /** One line; for a brief, the project's line in the Projects list. */
  readonly summary: string;
  /** Its text, linking to other entries as `#12`. */
  readonly text: string;
  /** When it was written or last changed, as an ISO date. */
  readonly written: string;
  /** When it was last read or sent. */
  readonly used?: string | undefined;
  /** The conversation that wrote it, and its title then. */
  readonly conversation?:
    { readonly id: string; readonly title: string } | undefined;
  readonly held?: MemoryHeld | undefined;
};

/** A change to an instruction that waits for the person to keep it. */
export type MemoryWaiting = {
  readonly id: string;
  /** The instruction it changes: About you, or How to work for a scope. */
  readonly scope: string;
  readonly section: "about" | "how";
  /** The rule as it would read; empty when the change removes one. */
  readonly rule: string;
  /** The rule it replaces or removes, word for word. */
  readonly replaces?: string | undefined;
  readonly conversation: { readonly id: string; readonly title: string };
  /** What outside content the conversation had read, said for the person. */
  readonly because: string;
  readonly at: string;
};

export type MemoryProject = {
  readonly id: string;
  readonly name: string;
  /** The folders whose conversations belong to it, by their full paths. */
  readonly folders: readonly string[];
  readonly archived?: true;
  readonly created: string;
  /** The projects merged into it, whose conversations it now holds. */
  readonly merged?: readonly string[];
};

/**
 * In estimated tokens, as every share of a request is, so a limit holds the
 * same in any script; knowledge in entries.
 */
export type MemoryLimits = {
  /** About the person and how to work for everything, together. */
  readonly instructions: number;
  /** How to work for one project. */
  readonly projectHow: number;
  readonly brief: number;
  /** A Knowledge entry's text. */
  readonly entry: number;
  /** A Knowledge entry's line in the list the model is sent: number, title, summary. */
  readonly line: number;
  /** A project's line in the Projects list: number, name, where it stands. */
  readonly projectLine: number;
  /** Knowledge entries in one scope. */
  readonly knowledge: number;
};

/**
 * Measured from sample memories, ADR 0026; the line from the lines models
 * wrote, ADR 0026.
 */
export const memoryLimits: MemoryLimits = {
  instructions: 4_000,
  projectHow: 2_000,
  brief: 1_500,
  entry: 1_500,
  line: 80,
  projectLine: 30,
  knowledge: 200,
};

/** How many lines of each list a conversation's first request carries. */
export const memoryListLengths = {
  /** In a project, its own Knowledge entries. */
  project: 60,
  /** In a project, the person's general Knowledge entries. */
  besideProject: 40,
  /** Outside any project, the conversation's own Knowledge entries, at most. */
  conversation: 60,
  /**
   * Outside any project, the conversation's own entries and the person's
   * general ones together: the person's fill what the conversation's leave.
   */
  alone: 100,
  projects: 20,
} as const;

/** Everything the Memory page shows. */
export type MemoryState = {
  /** Whether memory keeps and sends anything. */
  readonly on: boolean;
  readonly projects: readonly MemoryProject[];
  readonly entries: readonly MemoryEntry[];
  readonly waiting: readonly MemoryWaiting[];
  readonly limits: MemoryLimits;
  /** The person's folders where work of every kind passes, never linked. */
  readonly broadFolders: readonly string[];
};

/** One change a turn made to memory, as its card in the conversation shows it. */
export type MemoryChange = {
  /** The write, which Undo takes back. */
  readonly writeId: string;
  /** The entry, once it exists: a waiting change may be the first of its section. */
  readonly number?: number | undefined;
  readonly title: string;
  readonly change: "added" | "changed" | "removed" | "waiting";
  readonly scope: string;
  /** The scope as the person knows it: a project's name, or everything they do. */
  readonly scopeName: string;
  readonly section: MemorySection;
  /** For an entry removed because it was folded into another. */
  readonly mergedInto?: number | undefined;
  /** For a change that waits for the person. */
  readonly waiting?:
    | {
        readonly id: string;
        readonly rule: string;
        readonly replaces?: string | undefined;
        readonly because: string;
      }
    | undefined;
  /** What became of it since. */
  readonly state?: "undone" | "kept" | "discarded" | undefined;
};

/** A new entry the person writes, or an instruction they write the first time. */
export type MemoryDraft = {
  readonly scope: string;
  readonly section: MemorySection;
  readonly title?: string | undefined;
  readonly summary?: string | undefined;
  readonly text: string;
};

/** A change the person makes to an entry; what is left out stays. */
export type MemoryEdit = {
  readonly title?: string | undefined;
  readonly summary?: string | undefined;
  readonly text?: string | undefined;
};

/** What the person asks of memory, from the Memory page or a conversation. */
export type MemoryRequest =
  | { readonly kind: "switch"; readonly on: boolean }
  | { readonly kind: "add"; readonly draft: MemoryDraft }
  | {
      readonly kind: "edit";
      readonly number: number;
      readonly edit: MemoryEdit;
    }
  | { readonly kind: "remove"; readonly number: number }
  | { readonly kind: "move"; readonly number: number; readonly scope: string }
  /** A change that waited for the person: kept, or dropped. */
  | { readonly kind: "keep"; readonly waitingId: string }
  | { readonly kind: "discard"; readonly waitingId: string }
  /** Takes back one write, unless the entry changed since. */
  | { readonly kind: "undo"; readonly writeId: string }
  | { readonly kind: "createProject"; readonly name: string }
  /**
   * A project named after a conversation's folder and linked to it, unless
   * work of every kind passes there; the conversation is put in it.
   */
  | { readonly kind: "projectFromConversation"; readonly taskId: string }
  /**
   * Forgets, as the person chose when deleting a conversation, what it kept
   * for itself (`own`) and the person's Knowledge entries it wrote
   * (`general`).
   */
  | {
      readonly kind: "forgetConversation";
      readonly taskId: string;
      readonly own?: true;
      readonly general?: true;
    }
  | {
      readonly kind: "renameProject";
      readonly id: string;
      readonly name: string;
    }
  /** Asks the person for a folder and links it. */
  | { readonly kind: "linkFolder"; readonly id: string }
  | {
      readonly kind: "unlinkFolder";
      readonly id: string;
      readonly folder: string;
    }
  | {
      readonly kind: "archiveProject";
      readonly id: string;
      readonly archived: boolean;
    }
  | {
      readonly kind: "mergeProject";
      readonly from: string;
      readonly into: string;
    }
  /** Moves the project's memory to the Recycle Bin. */
  | { readonly kind: "deleteProject"; readonly id: string };

/** Whether a request was done, and what it made; a refusal says why. */
export type MemoryOutcome =
  | {
      readonly ok: true;
      /** A new entry's number. */
      readonly number?: number | undefined;
      /** A removal's write, which undo takes back. */
      readonly writeId?: string | undefined;
      readonly project?: MemoryProject | undefined;
    }
  | { readonly ok: false; readonly reason: string };

/** The person's choice of memory for one conversation; what is left out stays. */
export type ConversationMemoryChoice = {
  /** A project's id, or null for none. */
  readonly project?: string | null;
  /** Keep nothing from it. */
  readonly off?: boolean;
  /** Link the conversation's folder to the chosen project too. */
  readonly linkFolder?: true;
};
