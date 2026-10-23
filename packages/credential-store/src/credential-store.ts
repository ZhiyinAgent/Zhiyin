/**
 * Where Zhiyin keeps a secret: the Windows credential store, under the one
 * service name "Zhiyin", an entry per name.
 *
 * One Windows credential entry holds at most 1,280 characters, and a key a
 * person pastes can be longer: an identity provider's token often runs to two
 * thousand. A value that fits is kept in its one entry, as it always was; a
 * longer one is kept in numbered pieces, and the entry itself, written last,
 * says which pieces. Values in pieces take turns between two sets, so each is
 * written apart from the one before it, and a value half written reads as the
 * one before it, never as a mix of the two. Before pieces are written, an
 * entry of its own records which pieces may be left behind; once they are
 * removed it goes, and whatever a failed write or removal left, the next write
 * or delete under the name removes. No other name is touched.
 */

/** One entry of a credential store, in the shape the keyring gives it. */
export type CredentialEntry = {
  getPassword(): Promise<string | undefined>;
  setPassword(value: string): Promise<void>;
  deletePassword(): Promise<unknown>;
};

/** Opens the entry of a name. */
export type CredentialEntries = (name: string) => CredentialEntry;

/** The most one Windows credential entry holds. */
export const entryCharacters = 1_280;

/** Each piece of a longer value, kept under the limit with room to spare. */
const pieceCharacters = 1_200;

/** What the entry itself holds once its value is kept in pieces. */
const marker = "zhiyin-pieces:";

/** Which pieces a value is kept in: the set they belong to, and how many. */
type Pieces = { readonly set: number; readonly count: number };

/** The two sets values in pieces take turns in. */
const turns = [1, 2] as const;

const pieceName = (name: string, set: number, index: number) =>
  `${name}#piece:${String(set)}:${String(index)}`;

/** The entry recording the pieces that may be left behind. */
const leftName = (name: string) => `${name}#pieces-left`;

/** Pieces as the record writes them: "set:count", separated by spaces. */
const written = (all: readonly Pieces[]) =>
  all
    .map((pieces) => `${String(pieces.set)}:${String(pieces.count)}`)
    .join(" ");

/** A value of any length under `name`, in `entries`. */
export class PiecewiseCredential {
  readonly #entries: CredentialEntries;
  readonly #name: string;
  /**
   * Writes run one at a time: two at once would read the same pieces and
   * write over each other's, keeping a mix of both values.
   */
  #writing: Promise<unknown> = Promise.resolve();

  constructor(entries: CredentialEntries, name: string) {
    this.#entries = entries;
    this.#name = name;
  }

  async get(): Promise<string | undefined> {
    // A store may answer null for an entry it does not have.
    const held = (await this.#entries(this.#name).getPassword()) ?? undefined;
    if (held === undefined || !held.startsWith(marker)) return held;
    const pieces = piecesIn(held);
    if (!pieces) return undefined;
    const parts = await Promise.all(
      Array.from({ length: pieces.count }, (_, index) =>
        this.#entries(pieceName(this.#name, pieces.set, index)).getPassword(),
      ),
    );
    return parts.some((part) => part === undefined || part === null)
      ? undefined
      : parts.join("");
  }

  set(value: string): Promise<void> {
    return this.#inTurn(() => this.#set(value));
  }

  delete(): Promise<void> {
    return this.#inTurn(() => this.#delete());
  }

  #inTurn(write: () => Promise<void>): Promise<void> {
    const written = this.#writing.then(write, write);
    this.#writing = written.catch(() => undefined);
    return written;
  }

  /**
   * The value is kept once the entry is written. Pieces that cannot be removed
   * after that do not fail the write: the next write or delete removes them.
   */
  async #set(value: string): Promise<void> {
    const before = await this.#pieces();
    if (value.length <= entryCharacters && !value.startsWith(marker)) {
      await this.#record(before ? [before] : []);
      await this.#entries(this.#name).setPassword(value);
      await this.#clear(undefined, before).catch(() => undefined);
      return;
    }
    const parts = piecesOf(value);
    const pieces = {
      set: before?.set === turns[0] ? turns[1] : turns[0],
      count: parts.length,
    };
    await this.#record([pieces, ...(before ? [before] : [])]);
    try {
      for (const [index, part] of parts.entries())
        await this.#entries(
          pieceName(this.#name, pieces.set, index),
        ).setPassword(part);
      await this.#entries(this.#name).setPassword(
        `${marker}${String(pieces.set)}:${String(pieces.count)}`,
      );
    } catch (error) {
      await this.#clear(before, undefined).catch(() => undefined);
      throw error;
    }
    await this.#clear(pieces, before).catch(() => undefined);
  }

  async #delete(): Promise<void> {
    const before = await this.#pieces();
    await this.#record(before ? [before] : []);
    await this.#entries(this.#name).deletePassword();
    await this.#clear(undefined, before);
  }

  /**
   * Records pieces that may be left behind, before the entry stops naming
   * them or they are written, so a failure from then on leaves nothing
   * unrecorded. Nothing is written when there is nothing to add.
   */
  async #record(pieces: readonly Pieces[]): Promise<void> {
    if (!pieces.length) return;
    const left = await this.#left();
    await this.#entries(leftName(this.#name)).setPassword(
      written(merged([...left, ...pieces])),
    );
  }

  /** The pieces the value held now is kept in; none when it is whole. */
  async #pieces(): Promise<Pieces | undefined> {
    const held = (await this.#entries(this.#name).getPassword()) ?? undefined;
    return held?.startsWith(marker) ? piecesIn(held) : undefined;
  }

  /** The pieces the record says may be left behind; none it cannot read. */
  async #left(): Promise<readonly Pieces[]> {
    const held =
      (await this.#entries(leftName(this.#name)).getPassword()) ?? undefined;
    if (held === undefined) return [];
    return held
      .split(" ")
      .map((item) => piecesIn(`${marker}${item}`))
      .filter((pieces): pieces is Pieces => pieces !== undefined);
  }

  /**
   * Removes the pieces the record names, and those of `before`, all but the
   * ones `kept` holds, then the record. What could not be
   * removed is recorded again for the next write or delete.
   */
  async #clear(
    kept: Pieces | undefined,
    before: Pieces | undefined,
  ): Promise<void> {
    const left = await this.#left();
    const targets = merged([...left, ...(before ? [before] : [])]);
    const remaining: Pieces[] = [];
    let failure: unknown;
    for (const target of targets) {
      const from = kept?.set === target.set ? kept.count : 0;
      try {
        for (let index = from; index < target.count; index += 1)
          await this.#entries(
            pieceName(this.#name, target.set, index),
          ).deletePassword();
      } catch (error) {
        failure ??= error;
        remaining.push(target);
      }
    }
    if (remaining.length)
      await this.#entries(leftName(this.#name))
        .setPassword(written(remaining))
        .catch(() => undefined);
    else if (left.length)
      await this.#entries(leftName(this.#name)).deletePassword();
    if (failure !== undefined) throw failure;
  }
}

/**
 * A value cut into pieces between characters: a cut inside a character
 * outside the basic plane would leave each piece half of it, which the store,
 * keeping UTF-8, cannot hold.
 */
function piecesOf(value: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + pieceCharacters, value.length);
    const code = value.charCodeAt(end - 1);
    if (end < value.length && code >= 0xd800 && code <= 0xdbff) end -= 1;
    parts.push(value.slice(start, end));
    start = end;
  }
  return parts;
}

/** Each set once, at the most pieces any entry gives it. */
function merged(all: readonly Pieces[]): readonly Pieces[] {
  const counts = new Map<number, number>();
  for (const pieces of all)
    counts.set(pieces.set, Math.max(counts.get(pieces.set) ?? 0, pieces.count));
  return [...counts].map(([set, count]) => ({ set, count }));
}

function piecesIn(held: string): Pieces | undefined {
  const [set, count] = held.slice(marker.length).split(":").map(Number);
  return Number.isInteger(set) &&
    Number.isInteger(count) &&
    set! > 0 &&
    count! > 0
    ? { set: set!, count: count! }
    : undefined;
}

/** The Windows credential store's entries under the service "Zhiyin". */
export function keyringEntries(): CredentialEntries {
  const opened = new Map<string, Promise<CredentialEntry>>();
  return (name) => {
    const entry = () => {
      let found = opened.get(name);
      if (!found) {
        found = import("@napi-rs/keyring").then(
          ({ AsyncEntry }) => new AsyncEntry("Zhiyin", name),
        );
        opened.set(name, found);
      }
      return found;
    };
    return {
      getPassword: async () => (await entry()).getPassword(),
      setPassword: async (value) => (await entry()).setPassword(value),
      deletePassword: async () => (await entry()).deletePassword(),
    };
  };
}
