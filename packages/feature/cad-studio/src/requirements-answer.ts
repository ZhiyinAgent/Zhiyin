/**
 * A build's requirements as checked, as the harness writes them and as the
 * answer says them, and how each margin moved since the last build checked
 * against the same file in this conversation, which is kept in the
 * conversation's own folder.
 */

import type { ActionDetail } from "@zhiyin/contract";
import {
  checkedIn,
  keptOf,
  lastOf,
  verdictDetail,
  verdictLines,
  type Checked,
  type Last,
  type Says,
} from "@zhiyin/studio-requirements";
import { JsonRecord } from "./json-record.js";
import { asObject } from "./json-values.js";

export type { Checked };

/** The requirements the harness checked, if they are that; anything else is left out. */
export const requirementsIn = checkedIn;

/**
 * Each requirement file's requirements as the last build of each design
 * checked against it found them, by id: a margin moves only between builds
 * of the same design.
 */
export class Margins {
  readonly #record: JsonRecord<Record<string, unknown>>;

  constructor(path: string) {
    this.#record = new JsonRecord(path, asObject, () => ({}));
  }

  async last(
    file: string,
    design: string,
  ): Promise<Readonly<Record<string, Last>>> {
    return lastOf((await this.#record.read())[keyOf(file, design)]);
  }

  keep(
    file: string,
    design: string,
    checked: readonly Checked[],
    says: Says,
  ): Promise<void> {
    return this.#record.change((all) => {
      all[keyOf(file, design)] = keptOf(checked, says);
    });
  }
}

const keyOf = (file: string, design: string) =>
  JSON.stringify([file.toLowerCase(), design]);

/**
 * The lines an answer gives the requirements checked, each margin beside the
 * last build's, then each requirement that failed in the last build checked
 * against the file and is no longer in it.
 */
export function requirementsText(
  file: string,
  checked: readonly Checked[],
  says: Says,
  last: Readonly<Record<string, Last>>,
): string[] {
  return verdictLines({ file }, checked, says, last);
}

/**
 * The requirements as the person is shown them under the build. None for a
 * build checked against no requirements.
 */
export function requirementsDetail(
  file: string,
  checked: readonly Checked[],
  says: Says,
  last: Readonly<Record<string, Last>>,
): ActionDetail | undefined {
  return verdictDetail({ file }, checked, says, last);
}
