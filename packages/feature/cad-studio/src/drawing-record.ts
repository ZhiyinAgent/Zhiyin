/**
 * The drawings made in one conversation, each kept as it was asked for, by
 * the files it wrote: a drawing is drawn again from its own request, with any
 * input given anew in its place, so a conversation that has lost the request
 * from its context redraws it exactly. Kept in the conversation's own folder.
 */

import { JsonRecord } from "./json-record.js";
import { asObject } from "./json-values.js";

type Args = Readonly<Record<string, unknown>>;

export class DrawingRecord {
  readonly #record: JsonRecord<Record<string, Args>>;

  constructor(path: string) {
    this.#record = new JsonRecord(
      path,
      (value) => asObject(value) as Record<string, Args> | undefined,
      () => ({}),
    );
  }

  /** The request a drawing written to `output`, workspace-relative, was made with. */
  async request(output: string): Promise<Args | undefined> {
    const all = await this.#record.read();
    const found = all[key(output)];
    return found && typeof found === "object" ? found : undefined;
  }

  /** Notes a drawing's request under each file it wrote. */
  drew(outputs: readonly string[], request: Args): Promise<void> {
    return this.#record.change((all) => {
      for (const output of outputs) all[key(output)] = request;
    });
  }
}

/** One key for a path however it is written. */
const key = (output: string) =>
  output.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();

/**
 * A drawing's request: drawn again from the one kept for `again`, each input
 * given here in place of the kept one. Without again, the request as given.
 */
export async function requestOf(
  record: DrawingRecord,
  args: Args,
): Promise<{ ok: true; args: Args } | { ok: false; reason: string }> {
  const again = args["again"];
  if (again === undefined) return { ok: true, args };
  if (typeof again !== "string" || !again.trim())
    return {
      ok: false,
      reason:
        "again names a file a drawing in this conversation wrote, such as drawings/bracket.pdf.",
    };
  const kept = await record.request(again.trim());
  if (!kept)
    return {
      ok: false,
      reason: `No drawing in this conversation wrote ${again.trim()}, so there is none to draw again: give the drawing in full.`,
    };
  const given = Object.fromEntries(
    Object.entries(args).filter(([name]) => name !== "again"),
  );
  return { ok: true, args: { ...keptBeside(kept, given), ...given } };
}

/** What a drawing is drawn from: one input, given as code, a file or the scene. */
const sources = ["code", "file", "scene"];
/** What only a drawing of a script's parts, or only one of the scene, takes. */
const ofScript = ["arguments", "parts"];
const ofScene = ["objects"];

/**
 * The kept request, less what a source given anew replaces: the kept source
 * whole, and what belongs only to the other side when it switches between a
 * script and the scene. Between code and a file, the arguments and parts stay.
 */
function keptBeside(kept: Args, given: Args): Args {
  if (!sources.some((name) => given[name] !== undefined)) return kept;
  const toScene = given["scene"] === true;
  const fromScene = kept["scene"] === true;
  const dropped = [
    ...sources,
    ...(toScene && !fromScene ? ofScript : []),
    ...(!toScene && fromScene ? ofScene : []),
  ];
  return Object.fromEntries(
    Object.entries(kept).filter(([name]) => !dropped.includes(name)),
  );
}
