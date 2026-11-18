/**
 * Measuring between objects, which reads the scene and changes nothing, and
 * how a measure reads for approval.
 */

import { missingInputs } from "./needed-inputs.js";
import type { Args, Preparer } from "./prepared-call.js";
import { timeLimits } from "./time-limits.js";
import { inWords, type Row } from "./wording.js";

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : "?";

function measureRows(args: Args): Row[] {
  const [a, b] = Array.isArray(args["between"]) ? args["between"] : [];
  const kind = args["kind"] ?? "gap";
  const value =
    kind === "clearance"
      ? `how near everything else comes to ${text(args["from"])}`
      : kind === "centres"
        ? `the distance between the centres of ${text(a)} and ${text(b)}`
        : args["from"] !== undefined
          ? `what lies along ${text(args["along"])} from ${text(args["from"])}, and how far`
          : `the gap between ${text(a)} and ${text(b)}`;
  return [{ name: "Measure", value }];
}

export const prepareMeasure: Preparer = (args, { scene }) =>
  missingInputs("measure", args) ?? {
    command: "measure",
    args,
    timeoutMs: timeLimits.measure,
    action: "Measure distances in a 3D scene",
    target: scene,
    rows: inWords(measureRows(args)),
    access: "read",
  };
