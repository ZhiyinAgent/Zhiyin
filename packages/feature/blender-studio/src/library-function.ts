/** One function of the `zhiyin` library, as the catalog lists it. */
export type LibraryFunction = {
  readonly name: string;
  /** The call as written, with its arguments and their defaults. */
  readonly call: string;
  /** One line: what it is for. */
  readonly summary: string;
  /** What each argument means. */
  readonly arguments: readonly string[];
  readonly example: string;
  /** What its line in the script's answer says. */
  readonly reports: string;
  /** More words a search ranks it by. */
  readonly terms: readonly string[];
};
