/**
 * The catalog a conversation searches for what its enabled plugins bring
 * (ADR 0017): toolkits, skills, library functions, reference pages and known
 * API changes, each an entry found with `find` and read whole with `open`.
 */

/** What an entry is. */
export type CatalogEntryKind =
  "toolkit" | "skill" | "function" | "doc" | "break";

/** One entry, as a search returns it. */
export type CatalogEntry = {
  /** `kind:path`, as `toolkit:3d-rendering/surfacing` or `doc:blender/5.2/bpy.types.Object`. */
  readonly id: string;
  readonly kind: CatalogEntryKind;
  readonly title: string;
  /** One line: what the entry is for. */
  readonly summary: string;
  /** The plugin it belongs to; opening the entry activates it. */
  readonly plugin: string;
  /** More words the search ranks it by, below its title and summary, such as a tool's parameter names. */
  readonly terms?: readonly string[];
  /** Other names for what the entry does, as people put it, such as "round" for a fillet; ranked as its title is. */
  readonly aliases?: readonly string[];
};

/** An entry read whole. */
export type CatalogPage = {
  readonly entry: CatalogEntry;
  readonly text: string;
};

/** A toolkit's own words; its tools name it as their `toolkit`. */
export type ToolkitDeclaration = {
  /** Unique within its plugin, as `surfacing`. */
  readonly id: string;
  readonly title: string;
  readonly summary: string;
};

/** The most tools one toolkit holds. */
export const TOOLKIT_SIZE = 10;

/**
 * A change between the API models were trained on and the one Zhiyin runs
 * (ADR 0024): an error matching `pattern` is answered with the new form.
 */
export type ApiBreak = {
  /** A regular expression's source, matched against a failed script's error. */
  readonly pattern: string;
  /** The form a model writes. */
  readonly wrong: string;
  /** The form that works, as the answer gives it. */
  readonly right: string;
  /** Entries to read, by id. */
  readonly see: readonly string[];
};

/**
 * What a feature knows beyond its tools, handed to the catalog by the
 * composition root: its toolkits' words, its reference pages and functions,
 * and its known API changes. Pages may be built on the PC (ADR 0024), so they
 * are read when asked for.
 */
export type KnowledgeSource = {
  readonly plugin: string;
  readonly toolkits: readonly ToolkitDeclaration[];
  readonly breaks: readonly ApiBreak[];
  entries(): Promise<readonly CatalogEntry[]>;
  page(id: string): Promise<CatalogPage | undefined>;
};
