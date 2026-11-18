/** The person's Recycle Bin, as the application hands it to a feature. */
export type RecycleBin = {
  /**
   * Whether Windows would move each path to the Recycle Bin, asked without
   * moving anything. A path it could not tell about is left out.
   */
  recyclable(paths: readonly string[]): Promise<ReadonlyMap<string, boolean>>;
  /** Moves one item there. Rejects, deleting nothing, when it cannot. */
  recycle(path: string): Promise<void>;
};
