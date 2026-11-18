/**
 * What a reviewer is told of a design's requirements: each as first written
 * in the conversation with its latest measure, and what was removed, changed
 * or added since, so a requirement dropped to make the work pass is judged
 * all the same.
 */

import type { Requirement } from "./file.js";
import { figures } from "./ranges.js";
import type { Last } from "./verdicts.js";

export type Reviewed = {
  /** The heading: "Spec for Table in requirements.json". */
  readonly title: string;
  /** The requirements as first written in the conversation. */
  readonly first: readonly Requirement[];
  /** The requirements as the file holds them now. */
  readonly current: readonly Requirement[];
  /** The latest measure of each, by id. */
  readonly last: Readonly<Record<string, Last>>;
};

/** A requirement's own fields, beside its id, kind and words. */
function fields(requirement: Requirement): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(requirement).filter(
        ([key]) => key !== "id" && key !== "check" && key !== "says",
      ),
    ),
  );
}

function measure(last: Last | undefined): string {
  if (!last) return "not measured";
  if (last.holds === null) return "could not be measured";
  const by =
    last.margin !== undefined && last.margin !== 0
      ? `, ${figures(Math.abs(last.margin))}${last.unit ? ` ${last.unit}` : ""} ${last.margin < 0 ? "short" : "to spare"}`
      : "";
  return `${last.holds ? "holds" : "fails"}${by}`;
}

function line(requirement: Requirement, verdict: string): string {
  const says =
    typeof requirement["says"] === "string"
      ? `${JSON.stringify(requirement["says"])} `
      : "";
  return `- ${requirement.id} (${requirement.check}), ${verdict}: ${says}${fields(requirement)}`;
}

export function reviewBrief(reviewed: Reviewed): string {
  const now = new Map(reviewed.current.map((one) => [one.id, one]));
  const first = new Set(reviewed.first.map((one) => one.id));
  const changed = reviewed.first.flatMap((one) => {
    const current = now.get(one.id);
    return current &&
      (fields(current) !== fields(one) || current.check !== one.check)
      ? [`- ${one.id} now reads ${fields(current)}`]
      : [];
  });
  const added = reviewed.current.filter((one) => !first.has(one.id));
  return [
    `## ${reviewed.title}`,
    "",
    "Each requirement as first written in this conversation, with its latest measure:",
    ...reviewed.first.map((one) =>
      line(
        one,
        now.has(one.id) ? measure(reviewed.last[one.id]) : "removed since",
      ),
    ),
    ...(changed.length
      ? [
          "",
          "Changed since first written; judge the work by the first:",
          ...changed,
        ]
      : []),
    ...(added.length
      ? [
          "",
          "Added since first written:",
          ...added.map((one) => line(one, measure(reviewed.last[one.id]))),
        ]
      : []),
  ].join("\n");
}
