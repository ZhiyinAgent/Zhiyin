/**
 * The look-up of what the installed CAD library accepts: a helper's, a
 * build123d name's or a bd_warehouse part's inputs, read by Python from the
 * library itself, reading and writing nothing of the workspace.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ToolCallInspection } from "@zhiyin/contract";
import type { CadPython } from "./cad-python.js";
import { plainFile } from "./run-answer.js";
import { minutes } from "./run-time.js";
import { textResult } from "./tool-result.js";
import { notInstalled } from "./environment-words.js";
import { laterAnswer } from "./later-names.js";
import { removeRun } from "./run-folders.js";

type Args = Readonly<Record<string, unknown>>;

/** The tool that reads what the installed CAD library accepts. */
export const lookUp = "cad_api";
const lookUpRefusal =
  "Name a helper, a build123d name or a bd_warehouse part to look up in name, such as round_edges, extrude or bd_warehouse.fastener.HexHeadScrew, or up to twelve of them in names; not both.";
/** How long one look-up may take, and the same as the model is told it. */
const lookUpMs = minutes(1);
export const lookUpTime = "a minute";

/** The most names one look-up answers. */
const mostLookedUp = 12;

/** The names a look-up asks about, in order, if each is one. */
function lookedUp(args: Args): string[] | undefined {
  const one = args["name"];
  const many = args["names"];
  if ((one === undefined) === (many === undefined)) return undefined;
  const asked = one !== undefined ? [one] : many;
  if (
    !Array.isArray(asked) ||
    asked.length === 0 ||
    asked.length > mostLookedUp
  )
    return undefined;
  const names = asked.map((name) =>
    typeof name === "string" ? name.trim() : "",
  );
  return names.every((name) => /^[A-Za-z_][\w.]{0,199}$/.test(name))
    ? names
    : undefined;
}

/** What a look-up does, for the person to see: it needs no approval, as it reads only the library. */
export async function inspectLookUp(
  args: Args,
  python: CadPython,
): Promise<ToolCallInspection> {
  const asked = lookedUp(args);
  if (asked === undefined)
    return { ok: false, reason: lookUpRefusal, correctable: true };
  if ((await python.state()) !== "ready")
    return { ok: false, reason: notInstalled };
  return {
    ok: true,
    action: "Look up the CAD library",
    target: asked.join(", "),
    command: `${lookUp}(${JSON.stringify(asked.length === 1 ? { name: asked[0] } : { names: asked })})`,
    invocation: {
      name: "Look up the CAD library",
      arguments: [{ name: "Looks up", value: asked.join(", ") }],
    },
    detail:
      "Python reads the CAD library's own descriptions; nothing in the workspace is read or written.",
    // Zhiyin's own code reads the library Zhiyin installed.
    effects: {
      reads: "app",
      changes: "none",
      sends: "none",
      actsAsPerson: "none",
      runs: "none",
      lasting: false,
      brings: "none",
    },
    boundToCall: true,
    identity: JSON.stringify({ tool: lookUp, names: asked }),
  };
}

/** Reads the library's own descriptions of the names asked for, in a run of its own. */
export async function runLookUp(
  args: Args,
  python: CadPython,
  harness: string,
  directory: string,
  signal?: AbortSignal,
) {
  const asked = lookedUp(args);
  if (asked === undefined) return textResult(lookUpRefusal, true);
  // A name only a later release has is answered with what this one has
  // instead; asked with others, the harness places it among their answers.
  const later = Object.fromEntries(
    asked.flatMap((name) => {
      const said = laterAnswer(name);
      return said ? [[name, said]] : [];
    }),
  );
  if (asked.every((name) => name in later))
    return textResult(asked.map((name) => later[name]).join("\n\n"));
  const run = join(directory, "runs", randomUUID());
  const out = join(run, "out");
  await mkdir(out, { recursive: true });
  try {
    const request = join(run, "request.json");
    await writeFile(
      request,
      JSON.stringify({ api: asked, later, output: out }),
      "utf8",
    );
    const ran = await python.run({
      arguments: [harness, request],
      cwd: run,
      read: [dirname(harness), run],
      write: [out],
      home: join(run, "home"),
      homeLastsOneRun: true,
      timeoutMs: lookUpMs,
      ...(signal ? { signal } : {}),
    });
    if (!ran.ok) return textResult(ran.reason, true);
    if (ran.run.ending === "timeout")
      return textResult(
        `The look-up took longer than ${lookUpTime}, the most one may take, so it was stopped. Look up fewer names at a time.`,
        true,
      );
    const file = await plainFile(out, "answer.json", 256 * 1024);
    const said = file
      ? (JSON.parse(await readFile(file.path, "utf8")) as unknown)
      : undefined;
    const text =
      said && typeof said === "object" && "api" in said
        ? (said as { api: unknown }).api
        : undefined;
    return typeof text === "string"
      ? textResult(text)
      : textResult(
          `The CAD library could not be read.\n${`${ran.run.stdout}\n${ran.run.stderr}`.trim()}`,
          true,
        );
  } finally {
    await removeRun(run);
  }
}
