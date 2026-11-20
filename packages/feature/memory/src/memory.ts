import type { TakenBackBy } from "./taken-back.js";
import type {
  MemoryChange,
  MemoryDraft,
  MemoryEdit,
  MemoryHeld,
  MemoryProject,
  MemoryState,
  ToolSpec,
} from "@zhiyin/contract";

/** Who is writing, and what their conversation holds. */
export type WriteContext = {
  readonly conversation: { readonly id: string; readonly title: string };
  /** The conversation's project, when it is in one. */
  readonly project?: string | undefined;
  /** Everything the person wrote in the conversation, which a quote is checked against. */
  readonly personsWords: readonly string[];
  /**
   * What the conversation holds (ADR 0012). With outside content, a change to
   * an instruction waits for the person; `because` says, for them, what was
   * read.
   */
  readonly held: MemoryHeld & { readonly because?: string | undefined };
};

/** What a `remember` call came to. */
export type RememberOutcome =
  | {
      readonly ok: true;
      /** What the model is answered. */
      readonly answer: Readonly<Record<string, unknown>>;
      /** What the conversation's card shows. */
      readonly change: MemoryChange;
    }
  | {
      readonly ok: false;
      /** Why it was refused, said so the model can write it again. */
      readonly reason: string;
    };

/** What a `recall` call came to. */
export type RecallOutcome = {
  readonly answer: Readonly<Record<string, unknown>>;
  /** What the entries read held, which the conversation now holds too. */
  readonly held: MemoryHeld;
  /** What the read showed, for the person's record of it; absent for a refused call. */
  readonly shown?: RecallShown;
};

/** What a read showed: the entries given whole, and what it did not find. */
export type RecallShown = {
  readonly entries: readonly {
    readonly number: number;
    readonly title: string;
    readonly summary: string;
    readonly text: string;
  }[];
  /** Entries a search found beyond those given whole, as a list names them. */
  readonly alsoFound: readonly string[];
  /** Numbers asked for that name no entry. */
  readonly notKept: readonly number[];
  /**
   * Numbers asked for whose entry the person took back with the turn of this
   * conversation that kept it.
   */
  readonly takenBack: readonly number[];
  /** Searches that found nothing. */
  readonly nothingFor: readonly string[];
};

/** An entry as a list names it. */
export type EntryLine = {
  readonly number: number;
  readonly title: string;
  readonly summary: string;
};

/** One source of instructions, as sent, and whether it was cut to fit. */
export type SentInstruction = {
  readonly text: string;
  readonly truncated: boolean;
  /** Its size whole, in UTF-8 bytes. */
  readonly bytes: number;
};

/** What a conversation's first request carries of memory. */
export type MemoryStart = {
  /** Instructions: About you and How to work for everything, then the project's. */
  readonly instructions: {
    readonly about?: SentInstruction | undefined;
    readonly how?: SentInstruction | undefined;
    readonly projectHow?: SentInstruction | undefined;
  };
  /**
   * Data: the brief, the Projects list and the Knowledge lists, as the text
   * of the memory notice; empty when nothing is kept.
   */
  readonly known: string;
  /** What the instructions and brief sent held. */
  readonly held: MemoryHeld;
};

export type PersonsOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Memory: Markdown files under one folder, read again whenever they change,
 * so the person's own edits hold (ADR 0026). Writes are made one at a time.
 */
export interface Memory {
  /** Whether memory keeps and sends anything. */
  on(): Promise<boolean>;
  /** Turns memory on or off; what is kept stays either way. */
  switch(on: boolean): Promise<void>;
  /**
   * Calls `listener` after each change made through memory, by the model or
   * the person; the answer stops it. A listener that fails changes nothing.
   */
  onChange(listener: () => void): () => void;

  /**
   * The tool the model keeps memory with, as a conversation in a project, or
   * in none, is offered it: only the scopes it can use (ADR 0026).
   */
  rememberToolFor(inProject: boolean): ToolSpec;
  /** The tool the model reads memory with. */
  readonly recallTool: ToolSpec;
  remember(input: unknown, context: WriteContext): Promise<RememberOutcome>;
  /**
   * Reads for the conversation `conversationId`, which is told of a number
   * asked for that its own writes kept and the person took back with their
   * turn.
   */
  recall(input: unknown, conversationId?: string): Promise<RecallOutcome>;
  /**
   * The Knowledge entries close to `number` in its own scope and the
   * person's general one, closest first.
   */
  similarTo(number: number): Promise<readonly EntryLine[]>;
  /** The entries a full section would give up first: the least recently used. */
  leastUsed(scope: string, count: number): Promise<readonly EntryLine[]>;

  /**
   * What a conversation in `project`, or in none, is sent at its start; with
   * `conversation`, outside a project its own memory too, and in one what it
   * kept for itself is first carried into the project.
   */
  startOf(
    project: string | undefined,
    conversation?: string,
  ): Promise<MemoryStart>;
  /** The project a folder's conversations belong to: its most specific link. */
  projectFor(folder: string | undefined): Promise<MemoryProject | undefined>;
  /** Every project, archived ones too, in the order they were made. */
  projects(): Promise<readonly MemoryProject[]>;

  /** Everything the Memory page shows. */
  state(): Promise<MemoryState>;
  /** The folder memory keeps its files in, made if nothing is kept yet. */
  folder(): Promise<string>;
  /** Adds an entry the person wrote. */
  add(
    entry: MemoryDraft,
  ): Promise<PersonsOutcome & { readonly number?: number }>;
  edit(number: number, edit: MemoryEdit): Promise<PersonsOutcome>;
  /** Removes an entry; the answer is the write that `undo` takes back. */
  remove(
    number: number,
  ): Promise<PersonsOutcome & { readonly writeId?: string }>;
  /** Moves a Knowledge entry to another scope, keeping its number. */
  move(number: number, scope: string): Promise<PersonsOutcome>;
  /** Applies a change that waited for the person. */
  keep(waitingId: string): Promise<PersonsOutcome>;
  /** Drops a change that waited for the person. */
  discard(waitingId: string): Promise<PersonsOutcome>;
  /**
   * Takes back one write, unless the entry changed since; the answer says
   * which. With `by`, it is taken back with the turn that made it, and a
   * `recall` of its number in that conversation says so.
   */
  undo(writeId: string, by?: TakenBackBy): Promise<PersonsOutcome>;
  /**
   * Whether `undo` would take the write back now, or why not, changing
   * nothing.
   */
  undoable(writeId: string): Promise<PersonsOutcome>;
  /**
   * The conversation no longer shows these writes, as when the person went
   * back past their turn keeping what it kept: what they wrote stays, and
   * the records that would undo them are let go.
   */
  cardsGone(writeIds: readonly string[]): Promise<void>;
  /**
   * Lets go of what undoes a deleted conversation's writes, whose Undo its
   * cards offered. What it wrote stays.
   */
  conversationDeleted(conversationId: string): Promise<void>;
  /**
   * Removes, as the person chose, what a deleted conversation kept for
   * itself (`own`) and each of the person's Knowledge entries it wrote
   * (`general`), keeping nothing to undo it. An instruction it added a rule to is the person's too, and stays.
   */
  forgetConversation(
    conversationId: string,
    options: { readonly own: boolean; readonly general: boolean },
  ): Promise<PersonsOutcome>;

  createProject(
    name: string,
    folders?: readonly string[],
  ): Promise<PersonsOutcome & { readonly project?: MemoryProject }>;
  renameProject(id: string, name: string): Promise<PersonsOutcome>;
  linkFolder(id: string, folder: string): Promise<PersonsOutcome>;
  unlinkFolder(id: string, folder: string): Promise<PersonsOutcome>;
  archiveProject(id: string, archived: boolean): Promise<PersonsOutcome>;
  /** Moves every entry of `from` into `into`, keeping their numbers. */
  mergeProject(from: string, into: string): Promise<PersonsOutcome>;
  /** Moves the project's memory to the Recycle Bin. */
  deleteProject(id: string): Promise<PersonsOutcome>;
}
