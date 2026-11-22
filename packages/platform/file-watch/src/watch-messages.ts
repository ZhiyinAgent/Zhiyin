/**
 * What the owner of a watch and its thread say to each other. The thread holds
 * the files; the owner decides which, and is told what was saved.
 */

/** A file to hold, under the folder it is watched for. */
export type WatchItem = {
  readonly id: number;
  readonly root: string;
  readonly path: string;
};

/**
 * What the person chose for a file that cannot be saved within the room
 * left: save it all the same, let the write through without saving it, or
 * refuse the write.
 */
export type RoomDecision = "save" | "without" | "refuse";

export type ToThread =
  | {
      readonly kind: "watch";
      readonly batch: number;
      readonly items: readonly WatchItem[];
    }
  /** Saves each file still held, then lets it go, as a write would. */
  | {
      readonly kind: "settle";
      readonly batch: number;
      readonly ids: readonly number[];
    }
  /** Lets each file go without saving it. */
  | {
      readonly kind: "release";
      readonly batch: number;
      readonly ids: readonly number[];
    }
  /** Whether a write to a file watched for this folder saves it first, or goes through at once. */
  | { readonly kind: "saving"; readonly root: string; readonly on: boolean }
  /** How many bytes may be saved before the owner is asked. */
  | { readonly kind: "room"; readonly bytes: number }
  | {
      readonly kind: "decide";
      readonly id: number;
      readonly decision: RoomDecision;
    }
  | { readonly kind: "close" };

export type WatchResult =
  | { readonly id: number; readonly ok: true }
  | { readonly id: number; readonly ok: false; readonly reason: string };

export type FromThread =
  | {
      readonly kind: "watched";
      readonly batch: number;
      readonly results: readonly WatchResult[];
    }
  /**
   * A held file was saved and let go: its bytes as they were are at `staged`,
   * described by `record`, both on disk before anything could write to it.
   */
  | {
      readonly kind: "saved";
      readonly id: number;
      readonly root: string;
      readonly path: string;
      readonly staged: string;
      readonly record: string;
      readonly bytes: number;
      /** How long the writer waited, in milliseconds, from the break to the release. */
      readonly waitedMs: number;
    }
  /** A held file was let go without being saved: written outside a turn, or let through by the person. */
  | {
      readonly kind: "through";
      readonly id: number;
      readonly root: string;
      readonly path: string;
    }
  /** A held file was let go because it could not be saved: why, and what was done. */
  | {
      readonly kind: "unsaved";
      readonly id: number;
      readonly root: string;
      readonly path: string;
      readonly reason: string;
    }
  /** A held file's write was refused: the file stays held until released. */
  | {
      readonly kind: "refused";
      readonly id: number;
      readonly root: string;
      readonly path: string;
    }
  /** A write to a held file waits for the owner: saving it needs more room than is left. */
  | {
      readonly kind: "needs-room";
      readonly id: number;
      readonly root: string;
      readonly path: string;
      readonly bytes: number;
    }
  | { readonly kind: "done"; readonly batch: number }
  | { readonly kind: "closed" };
