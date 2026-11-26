/**
 * DeepSeek's models write a tool call in DeepSeek's own markup, DSML, which
 * DeepSeek turns into the call's fields: `<｜DSML｜invoke name="…">` and
 * one `<｜DSML｜parameter name="…" string="true|false">` block per input
 * field, its value JSON where `string` is false (DeepSeek-V3.2 encoding,
 * checked 2026-11-26). DeepSeek V4.1 Flash has been seen to leave some of it
 * in a call: a field of the input, such as a tool's name, runs on past the
 * name into `">` and the parameter blocks that hold the rest of the input,
 * written with two bars on each side of DSML.
 *
 * Such a call is read as the call it is: the field keeps the name before the
 * markup, and each parameter becomes a field beside it, in place of one the
 * call left empty. A call is passed on as it streams until its markup begins;
 * the rest is held until the answer ends, then passed on as read.
 * Markup that does not read whole, or a reading that would change anything
 * already passed on, leaves the call as it came.
 */

import type { ModelEvent } from "../../model-client.js";

/** Where the markup begins, as it stands escaped in a JSON string. */
const leakBegins = /\\">(?:\s|\\[nrt])*<｜{1,2}\s*DSML/u;

/** Text that could still grow into the beginning of the markup. */
const couldBegin =
  /^\\(?:"(?:>(?:(?:\s|\\[nrt]?)*(?:<(?:｜{1,2}\s*(?:D(?:S(?:M)?)?)?)?)?)?)?)?$/u;

/** The longest end of a call's text held back to see whether markup begins. */
const longestHeld = 64;

const bars = "｜{1,2}\\s*DSML\\s*｜{1,2}\\s*";
const parameterOpens = new RegExp(
  `^<${bars}parameter\\s+name="([^"]+)"\\s+string="(true|false)"\\s*>`,
  "u",
);
const parameterCloses = new RegExp(`^</${bars}parameter\\s*>`, "u");
const nextTag = new RegExp(`</?${bars}`, "u");
const closingTags = new RegExp(
  `^(?:</${bars}(?:parameter|invoke|function_calls)\\s*>\\s*)*$`,
  "u",
);

type Leak = {
  readonly name: string;
  readonly parameters: ReadonlyMap<string, unknown>;
};

/** A field's value read as a name run on into parameter blocks, if it reads. */
function readLeak(value: unknown): Leak | undefined {
  if (typeof value !== "string") return undefined;
  const head = /^([\w.-]+)">\s*/u.exec(value);
  if (!head?.[1]) return undefined;
  const parameters = new Map<string, unknown>();
  let rest = value.slice(head[0].length);
  let opens = parameterOpens.exec(rest);
  while (opens) {
    const [opening, key = "", kind] = opens;
    rest = rest.slice(opening.length);
    // A value runs to its closing tag, or else to the next tag or the end.
    const end = nextTag.exec(rest)?.index ?? rest.length;
    const text = rest.slice(0, end);
    rest = rest.slice(end);
    rest = rest.slice(parameterCloses.exec(rest)?.[0].length ?? 0).trimStart();
    if (parameters.has(key)) return undefined;
    if (kind === "true") parameters.set(key, text);
    else {
      try {
        parameters.set(key, JSON.parse(text) as unknown);
      } catch {
        return undefined;
      }
    }
    opens = parameterOpens.exec(rest);
  }
  if (parameters.size === 0 || !closingTags.test(rest)) return undefined;
  return { name: head[1], parameters };
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value).length === 0;
}

/**
 * What follows `passed`, the call's text up to where its markup begins, for
 * the whole to read as the call the markup holds; undefined when it does not
 * read.
 */
function readCall(text: string, passed: string): string | undefined {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const fields = Object.entries(input as Record<string, unknown>);
  const at = fields.findIndex(([, value]) => readLeak(value) !== undefined);
  const field = fields[at]?.[0];
  const leak = readLeak(fields[at]?.[1]);
  if (field === undefined || !leak || leak.parameters.has(field))
    return undefined;
  const before = fields.slice(0, at);
  if (before.some(([key]) => leak.parameters.has(key))) return undefined;
  const after: [string, unknown][] = fields
    .slice(at + 1)
    .map(([key, value]) => [
      key,
      isEmpty(value) && leak.parameters.has(key)
        ? leak.parameters.get(key)
        : value,
    ]);
  for (const [key, value] of leak.parameters)
    if (!fields.some(([own]) => own === key)) after.push([key, value]);
  const rest = `"${after
    .map(([key, value]) => `, ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join("")}}`;
  const meant = JSON.stringify(
    Object.fromEntries([...before, [field, leak.name], ...after]),
  );
  try {
    return JSON.stringify(JSON.parse(passed + rest)) === meant
      ? rest
      : undefined;
  } catch {
    return undefined;
  }
}

type Call = {
  /** Every fragment of the call's arguments so far. */
  text: string;
  /** How much of `text` has been passed on. */
  passed: number;
  /** Whether its markup has begun, past what was passed on. */
  leaked: boolean;
};

/** Where the end of `unsent` that could begin the markup starts. */
function heldFrom(unsent: string): number {
  for (
    let at = Math.max(0, unsent.length - longestHeld);
    at < unsent.length;
    at++
  )
    if (unsent[at] === "\\" && couldBegin.test(unsent.slice(at))) return at;
  return unsent.length;
}

/** What of a call can be passed on, now that its newest fragment arrived. */
function passable(call: Call): string {
  if (call.leaked) return "";
  const unsent = call.text.slice(call.passed);
  const leak = leakBegins.exec(unsent);
  const ready = unsent.slice(0, leak ? leak.index : heldFrom(unsent));
  call.leaked = leak !== null;
  call.passed += ready.length;
  return ready;
}

/** The events of a DeepSeek answer, each leaked call in it read as it is. */
export async function* withLeakedCallsRead(
  events: AsyncIterable<ModelEvent>,
): AsyncIterable<ModelEvent> {
  const calls = new Map<number, Call>();

  function* release(): Iterable<ModelEvent> {
    for (const [index, call] of calls) {
      const passed = call.text.slice(0, call.passed);
      const unsent = call.text.slice(call.passed);
      const rest = call.leaked
        ? (readCall(call.text, passed) ?? unsent)
        : unsent;
      call.text = passed + rest;
      call.passed = call.text.length;
      call.leaked = false;
      if (rest) yield { kind: "toolCallDelta", index, argumentsDelta: rest };
    }
  }

  for await (const event of events) {
    if (event.kind !== "toolCallDelta") {
      // The answer's calls have ended once it is done, and not before: other
      // events, such as an empty text, may arrive between a call's fragments.
      if (event.kind === "done") yield* release();
      yield event;
      continue;
    }
    if (event.argumentsDelta === undefined) {
      yield event;
      continue;
    }
    const call = calls.get(event.index) ?? {
      text: "",
      passed: 0,
      leaked: false,
    };
    calls.set(event.index, call);
    call.text += event.argumentsDelta;
    const ready = passable(call);
    if (ready || event.callId !== undefined || event.name !== undefined)
      yield {
        kind: "toolCallDelta",
        index: event.index,
        ...(event.callId === undefined ? {} : { callId: event.callId }),
        ...(event.name === undefined ? {} : { name: event.name }),
        ...(ready ? { argumentsDelta: ready } : {}),
      };
  }
  yield* release();
}
