/**
 * The model list as a file (ADR 0031): one document for every lab, the form
 * Zhiyin ships it in and the form a newer list is published in. A list
 * downloaded while the app runs is data, never code, so it is read strictly:
 * it may only describe models of labs this version already reaches, in the
 * shapes this version already sends. Anything it does not recognise, or any
 * value outside what a real model could have, refuses the whole file.
 *
 * A lab this version does not know is passed over: a later version may add
 * one, and the rest of the list still holds for this one. Anything else a
 * later version needs to say goes in a new format, published at an address of
 * its own, so a file in this format always reads the same in every version.
 */

import {
  REASONING_EFFORTS,
  type ModelPrice,
  type ReasoningCapabilities,
  type ReasoningEffort,
} from "@zhiyin/contract";
import type { ListedModel, ModelList } from "./model-list.js";

/** The one format this version reads. */
const MODEL_LIST_FORMAT = 1;

/** One lab's part of the file: its models, and where they were checked. */
type LabModelList = ModelList & {
  /** The pages the entries were checked against. */
  readonly sources: readonly string[];
  readonly note?: string;
};

export type ModelListFile = {
  readonly format: typeof MODEL_LIST_FORMAT;
  /** Higher in every list published after it. */
  readonly version: number;
  /** The day it was published. */
  readonly published: string;
  /** By provider id, the labs this version reaches. */
  readonly labs: Readonly<Record<string, LabModelList>>;
};

/**
 * The platforms of every lab this version reaches, by provider id: its
 * region ids, or `default` for a lab with one platform.
 */
export type LabPlatforms = ReadonlyMap<string, readonly string[]>;

export type ModelListReading =
  | { readonly ok: true; readonly list: ModelListFile }
  | { readonly ok: false; readonly problem: string };

/**
 * The most a list may charge per million tokens of any kind, by currency:
 * far above any model's price (the highest on the list on 2026-10-22 is
 * USD 50 and CNY 100), so it only stops a value no lab could mean.
 */
const PRICE_CEILINGS: Readonly<Record<string, number>> = {
  USD: 1_000,
  CNY: 7_000,
};

/** More tokens than any model's window: 100 million. */
const MOST_TOKENS = 100_000_000;

/** A value that is not what the list allows, said with where it is. */
class Refusal extends Error {}

type Fields = Readonly<Record<string, unknown>>;

function refuse(at: string, problem: string): never {
  throw new Refusal(`${at} ${problem}`);
}

function object(value: unknown, at: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    refuse(at, "is not an object.");
  return value as Fields;
}

/** An object with no field but those allowed. */
function record(value: unknown, at: string, allowed: readonly string[]) {
  const fields = object(value, at);
  for (const field of Object.keys(fields))
    if (!allowed.includes(field))
      refuse(`${at}.${field}`, "is not a field the list has.");
  return fields;
}

function text(value: unknown, at: string): string {
  if (typeof value !== "string" || value.trim() === "")
    refuse(at, "is not a text.");
  return value;
}

function day(value: unknown, at: string): string {
  const written = text(value, at);
  const parsed = new Date(`${written}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(written) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== written
  )
    refuse(at, "is not a day written YYYY-MM-DD.");
  return written;
}

function whole(value: unknown, at: string, least: number, most: number) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < least ||
    value > most
  )
    refuse(at, `is not a whole number from ${least} to ${most}.`);
  return value;
}

function yesNo(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") refuse(at, "is not true or false.");
  return value;
}

function list(value: unknown, at: string): readonly unknown[] {
  if (!Array.isArray(value)) refuse(at, "is not a list.");
  return value;
}

function rate(value: unknown, at: string, currency: string): number {
  const ceiling = PRICE_CEILINGS[currency] ?? 0;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > ceiling
  )
    refuse(at, `is not a price above 0 and at most ${ceiling} ${currency}.`);
  return value;
}

const rateFields = ["input", "cacheRead", "cacheWrite", "output"] as const;

function rates(fields: Fields, at: string, currency: string) {
  const read = (field: (typeof rateFields)[number]) =>
    fields[field] === undefined
      ? {}
      : { [field]: rate(fields[field], `${at}.${field}`, currency) };
  return {
    input: rate(fields["input"], `${at}.input`, currency),
    ...read("cacheRead"),
    ...read("cacheWrite"),
    output: rate(fields["output"], `${at}.output`, currency),
  };
}

function price(value: unknown, at: string): Omit<ModelPrice, "checked"> {
  const fields = record(value, at, [
    "currency",
    ...rateFields,
    "tiers",
    "peak",
  ]);
  const currency = text(fields["currency"], `${at}.currency`);
  if (!(currency in PRICE_CEILINGS))
    refuse(`${at}.currency`, "is neither USD nor CNY.");
  const tiers =
    fields["tiers"] === undefined
      ? undefined
      : list(fields["tiers"], `${at}.tiers`).map((tier, index) => {
          const where = `${at}.tiers[${index}]`;
          const each = record(tier, where, ["aboveInputTokens", ...rateFields]);
          return {
            aboveInputTokens: whole(
              each["aboveInputTokens"],
              `${where}.aboveInputTokens`,
              1,
              MOST_TOKENS,
            ),
            ...rates(each, where, currency),
          };
        });
  if (
    tiers &&
    new Set(tiers.map((tier) => tier.aboveInputTokens)).size !== tiers.length
  )
    refuse(`${at}.tiers`, "names one size twice.");
  return {
    currency,
    ...rates(fields, at, currency),
    ...(tiers ? { tiers } : {}),
    ...(fields["peak"] === undefined
      ? {}
      : { peak: peak(fields["peak"], `${at}.peak`, currency) }),
  };
}

function peak(value: unknown, at: string, currency: string) {
  const fields = record(value, at, ["weekdaysUtc", "hoursUtc", ...rateFields]);
  const weekdaysUtc = list(fields["weekdaysUtc"], `${at}.weekdaysUtc`).map(
    (weekday, index) => whole(weekday, `${at}.weekdaysUtc[${index}]`, 0, 6),
  );
  const hoursUtc = list(fields["hoursUtc"], `${at}.hoursUtc`).map(
    (span, index) => {
      const where = `${at}.hoursUtc[${index}]`;
      const [from, to, ...rest] = list(span, where);
      const hours = [
        whole(from, where, 0, 23),
        whole(to, where, 1, 24),
      ] as const;
      if (rest.length > 0 || hours[0] >= hours[1])
        refuse(where, "is not an hour followed by a later one.");
      return hours;
    },
  );
  if (weekdaysUtc.length === 0 || hoursUtc.length === 0)
    refuse(at, "names no days or no hours.");
  return { weekdaysUtc, hoursUtc, ...rates(fields, at, currency) };
}

function effort(value: unknown, at: string): ReasoningEffort {
  if (!REASONING_EFFORTS.includes(value as ReasoningEffort))
    refuse(at, "is not an effort Zhiyin sends.");
  return value as ReasoningEffort;
}

function reasoning(value: unknown, at: string): ReasoningCapabilities {
  const status = (value as Fields | null)?.["status"];
  if (status === "unavailable") {
    const fields = record(value, at, ["status", "reason"]);
    return {
      status: "unavailable",
      reason: text(fields["reason"], `${at}.reason`),
    };
  }
  const fields = record(value, at, [
    "status",
    "required",
    "defaultEnabled",
    "defaultEffort",
    "efforts",
  ]);
  if (status !== "available")
    refuse(`${at}.status`, "is neither available nor unavailable.");
  const efforts = list(fields["efforts"], `${at}.efforts`).map((each, index) =>
    effort(each, `${at}.efforts[${index}]`),
  );
  if (new Set(efforts).size !== efforts.length)
    refuse(`${at}.efforts`, "names one effort twice.");
  const defaultEffort =
    fields["defaultEffort"] === undefined
      ? undefined
      : effort(fields["defaultEffort"], `${at}.defaultEffort`);
  if (defaultEffort && !efforts.includes(defaultEffort))
    refuse(`${at}.defaultEffort`, "is not one of its efforts.");
  return {
    status: "available",
    required: yesNo(fields["required"], `${at}.required`),
    defaultEnabled: yesNo(fields["defaultEnabled"], `${at}.defaultEnabled`),
    ...(defaultEffort ? { defaultEffort } : {}),
    efforts,
  };
}

function model(
  value: unknown,
  at: string,
  platforms: readonly string[],
): ListedModel {
  const fields = record(value, at, [
    "id",
    "name",
    "contextWindow",
    "maximumOutputTokens",
    "acceptsImages",
    "reasoning",
    "offered",
    "note",
  ]);
  const contextWindow = whole(
    fields["contextWindow"],
    `${at}.contextWindow`,
    1,
    MOST_TOKENS,
  );
  const offered = record(fields["offered"], `${at}.offered`, platforms);
  if (Object.keys(offered).length === 0)
    refuse(`${at}.offered`, "names no platform.");
  return {
    id: text(fields["id"], `${at}.id`),
    name: text(fields["name"], `${at}.name`),
    contextWindow,
    ...(fields["maximumOutputTokens"] === undefined
      ? {}
      : {
          maximumOutputTokens: whole(
            fields["maximumOutputTokens"],
            `${at}.maximumOutputTokens`,
            1,
            contextWindow,
          ),
        }),
    acceptsImages: yesNo(fields["acceptsImages"], `${at}.acceptsImages`),
    reasoning: reasoning(fields["reasoning"], `${at}.reasoning`),
    offered: Object.fromEntries(
      Object.entries(offered).map(([where, listed]) => [
        where,
        listed === null ? null : price(listed, `${at}.offered.${where}`),
      ]),
    ),
    ...(fields["note"] === undefined
      ? {}
      : { note: text(fields["note"], `${at}.note`) }),
  };
}

function lab(
  value: unknown,
  at: string,
  platforms: readonly string[],
): LabModelList {
  const fields = record(value, at, ["checked", "sources", "note", "models"]);
  const sources = list(fields["sources"], `${at}.sources`).map(
    (source, index) => text(source, `${at}.sources[${index}]`),
  );
  if (sources.length === 0) refuse(`${at}.sources`, "names no page.");
  const models = list(fields["models"], `${at}.models`).map((each, index) =>
    model(each, `${at}.models[${index}]`, platforms),
  );
  if (new Set(models.map((each) => each.id)).size !== models.length)
    refuse(`${at}.models`, "lists one model twice.");
  return {
    checked: day(fields["checked"], `${at}.checked`),
    sources,
    ...(fields["note"] === undefined
      ? {}
      : { note: text(fields["note"], `${at}.note`) }),
    models,
  };
}

/**
 * Reads a parsed list for the labs this version reaches. The list it answers
 * holds only those labs, and only what the format allows.
 */
export function readModelList(
  value: unknown,
  platforms: LabPlatforms,
): ModelListReading {
  try {
    const format = (value as Fields | null)?.["format"];
    if (format !== MODEL_LIST_FORMAT)
      refuse(
        "The list",
        `is in format ${String(format)}, which this version does not read.`,
      );
    const fields = record(value, "The list", [
      "format",
      "version",
      "published",
      "labs",
    ]);
    const labs = object(fields["labs"], "labs");
    return {
      ok: true,
      list: {
        format: MODEL_LIST_FORMAT,
        version: whole(
          fields["version"],
          "version",
          1,
          Number.MAX_SAFE_INTEGER,
        ),
        published: day(fields["published"], "published"),
        labs: Object.fromEntries(
          Object.entries(labs).flatMap(([id, part]) => {
            const known = platforms.get(id);
            return known ? [[id, lab(part, `labs.${id}`, known)]] : [];
          }),
        ),
      },
    };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, problem: error.message };
    throw error;
  }
}
