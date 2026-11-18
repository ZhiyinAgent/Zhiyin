/**
 * A build or a drawing as the harness runs it: two confined runs, one after
 * the other. The first runs the model's script, from a copy of the files its
 * approval saw, and writes only the parts it built, as exact geometry with
 * what was said of them. The second is the harness alone, in isolated
 * Python, given those files as its only input: it measures, checks, draws
 * and exports the parts and writes the answer, which is the only one read.
 * The model's code never runs where its parts are measured. A drawing of the
 * 3D scene runs no script, so it is the second run alone.
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CadPython } from "./cad-python.js";
import type { Prepared } from "./call-preparation.js";
import { answerIn, plainFile, previewFile } from "./run-answer.js";
import { moreTime, timeWords } from "./run-time.js";
import { besideHint } from "./beside-hint.js";
import { crashReport } from "./crash-report.js";
import { textResult } from "./tool-result.js";
import { breakLines, hintLines } from "./break-answer.js";
import type { BuildAnswer } from "./wording.js";
import type { DrawingAnswer } from "./run-answer.js";
import { measuredHere } from "./requirements-request.js";

/** What a build's runs came to: the answer to read, or the call's answer already, as a failure. */
export type Ran =
  | {
      readonly done: true;
      /** The folder the answer and its files are in. */
      readonly out: string;
      readonly answer:
        | Exclude<BuildAnswer, { readonly failed: string }>
        | Exclude<DrawingAnswer, { readonly failed: string }>;
      /** What the script printed, in the run that ran it. */
      readonly printed: string;
      /** The known API changes the script's warnings show, each with its fix. */
      readonly changes: readonly string[];
    }
  | { readonly done: false; readonly result: ReturnType<typeof textResult> };

type Outcome = Extract<
  Awaited<ReturnType<CadPython["run"]>>,
  { readonly ok: true }
>["run"];

/** The most the model's script may print, across both streams, before it is stopped. */
const largestOutput = 64 * 1024 * 1024;

/** The steps a run had taken, which the harness writes down as it goes. */
async function progressIn(folder: string): Promise<string> {
  const progress = await plainFile(folder, "progress.txt", 64 * 1024);
  return progress ? (await readFile(progress.path, "utf8")).trim() : "";
}

/** A run that did not finish, in words: which way, how far it got, and what the script printed. */
function unfinished(
  tool: Prepared["tool"],
  ran: Outcome,
  timeMs: number,
  got: string,
  printed: string,
) {
  const run = tool === "cad_draw" ? "drawing" : "build";
  return textResult(
    [
      `The ${run} did not finish: ${
        ran.ending === "timeout"
          ? `it ran past ${timeWords(timeMs)} a ${run} has.`
          : ran.ending === "outputLimit"
            ? `it printed more than ${largestOutput / 1024 / 1024} MB, the most a ${run} may print.`
            : ran.ending === "stopped"
              ? "it was stopped."
              : `it was stopped, or ran past ${timeWords(timeMs)} a ${run} has.`
      }`,
      got && `How far it got:\n${got}`,
      ran.ending === "timeout" && moreTime(run),
      ran.ending === "outputLimit" &&
        "Print less from the script, such as a summary.",
      printed.trim() && `What the script printed:\n${printed.trim()}`,
    ]
      .filter(Boolean)
      .join("\n"),
    true,
  );
}

/**
 * A run that ended with no answer: where Python crashed, when it did, and
 * what the script printed; otherwise all the run printed.
 */
function noAnswer(ran: Outcome, printed: string, own: readonly string[]) {
  const crash = crashReport(ran.stderr, own);
  if (!crash)
    return textResult(
      `The CAD studio could not build this.\n${`${ran.stdout}\n${ran.stderr}`.trim()}`,
      true,
    );
  return textResult(
    [crash, printed.trim() && `What the script printed:\n${printed.trim()}`]
      .filter(Boolean)
      .join("\n"),
    true,
  );
}

/** A file's content's digest, as the approval's fingerprint has it. */
async function digestOf(path: string): Promise<string | undefined> {
  try {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * A copy of exactly the files the approval fingerprinted, laid out as the
 * workspace has them, each checked against the digest the decision saw; or
 * nothing, when one has changed since.
 */
async function snapshot(
  prepared: Prepared,
  into: string,
): Promise<string | undefined> {
  const file = prepared.file!;
  const sources = prepared.sources!;
  const from = dirname(file.absolute);
  const to = join(into, dirname(file.relative));
  for (const [relative, digest] of Object.entries(sources)) {
    const copy = join(to, relative);
    await mkdir(dirname(copy), { recursive: true });
    try {
      await copyFile(join(from, relative), copy);
    } catch {
      return undefined;
    }
    if ((await digestOf(copy)) !== digest) return undefined;
  }
  return into;
}

/** The request each run of the harness reads, as data. */
function measuring(
  prepared: Prepared,
  out: string,
  seconds: number,
  preview: boolean,
) {
  return {
    output: out,
    seconds,
    ...(prepared.positions ? { positions: prepared.positions } : {}),
    ...(prepared.steps ? { steps: prepared.steps } : {}),
    ...(prepared.sweep ? { sweep: prepared.sweep } : {}),
    ...(prepared.sections ? { sections: prepared.sections } : {}),
    ...(prepared.explode ? { explode: prepared.explode } : {}),
    ...(prepared.requirements && measuredHere(prepared.requirements.list).length
      ? { requirements: measuredHere(prepared.requirements.list) }
      : {}),
    ...(prepared.drawing
      ? {
          exports: [],
          drawing: {
            ...prepared.drawing,
            outputs: prepared.exports.map((one, index) => ({
              file: `export-${index}.${one.kind}`,
              // As the model named it, for what the drawing says of it.
              name: one.relative,
              kind: one.kind,
              ...(one.view ? { view: one.view } : {}),
            })),
            picture: "picture.png",
          },
          picture: null,
        }
      : {
          exports: prepared.exports.map((one, index) => ({
            file: `export-${index}.${one.kind}`,
            // As the model named it, for the files a parts list names.
            name: one.relative,
            kind: one.kind,
            ...(one.materials ? { materials: one.materials } : {}),
            ...(one.parts ? { parts: one.parts } : {}),
            ...(one.detail ? { detail: one.detail } : {}),
            ...(one.exploded ? { exploded: true } : {}),
          })),
          picture: "picture.png",
          ...(preview ? { preview: previewFile } : {}),
        }),
  };
}

/**
 * Runs a call's script, then measures what it built, in `run`, the call's
 * own folder: `lines`, for a drawing of the scene, are the lines Blender
 * found, and no script runs.
 */
export async function runBuild(options: {
  readonly python: CadPython;
  readonly harness: string;
  readonly root: string;
  readonly run: string;
  readonly prepared: Prepared;
  readonly lines?: string;
  readonly timeMs: number;
  readonly preview: boolean;
  readonly signal?: AbortSignal;
}): Promise<Ran> {
  const { python, harness, root, run, prepared, timeMs } = options;
  const began = Date.now();
  const tool = prepared.tool;
  const signal = options.signal ? { signal: options.signal } : {};
  let printed = "";
  let warned = "";
  let handed: string | undefined;
  const scripted = join(run, "script");
  if (!options.lines) {
    // The first run: the model's script, and nothing that measures it.
    await mkdir(scripted, { recursive: true });
    const script = join(run, "script.py");
    await writeFile(script, prepared.code, "utf8");
    const source =
      prepared.file && prepared.sources
        ? await snapshot(prepared, join(run, "snapshot"))
        : undefined;
    if (prepared.file && prepared.sources && !source)
      return {
        done: false,
        result: textResult(
          `${prepared.file.relative} or a file beside it changed after this ${tool === "cad_draw" ? "drawing" : "build"} was approved, so it did not run. Ask again to approve it as it is now.`,
          true,
        ),
      };
    const request = join(run, "script.json");
    await writeFile(
      request,
      JSON.stringify({
        phase: "script",
        script,
        file: prepared.file?.absolute ?? null,
        // What an error calls the script: as the model named it.
        name: prepared.file?.relative ?? null,
        ...(source ? { source } : {}),
        arguments: prepared.arguments,
        ...(prepared.positions ? { positions: prepared.positions } : {}),
        output: scripted,
        // The time the build has, so positions it cannot reach are named, not lost.
        seconds: timeMs / 1000,
      }),
      "utf8",
    );
    const first = await python.run({
      // Neither the script's folder nor the current one is on Python's
      // path, and nothing compiled is written: what imports is the copy.
      arguments: ["-P", "-B", harness, request],
      cwd: root,
      read: [root, dirname(harness), run],
      write: [scripted],
      // A home of the run's own, gone with it, so nothing is kept between builds.
      home: join(run, "home"),
      homeLastsOneRun: true,
      timeoutMs: timeMs,
      maximumOutputBytes: largestOutput,
      ...signal,
    });
    if (!first.ok)
      return { done: false, result: textResult(first.reason, true) };
    printed = first.run.stdout;
    warned = first.run.stderr;
    if (first.run.exitCode === null)
      return {
        done: false,
        result: unfinished(
          tool,
          first.run,
          timeMs,
          await progressIn(scripted),
          printed,
        ),
      };
    // The script's own failure is the model's to read; nothing else of this run is.
    const failed = await answerIn(scripted, "build");
    if (failed && "failed" in failed)
      return {
        done: false,
        result: textResult(
          [
            failed.failed,
            ...breakLines(`${failed.failed}\n${warned}`),
            ...hintLines(failed.failed),
            !prepared.file && (await besideHint(root, failed.failed)),
            printed.trim() && `What the script printed:\n${printed.trim()}`,
          ]
            .filter(Boolean)
            .join("\n"),
          true,
        ),
      };
    const manifest = await plainFile(scripted, "manifest.json", Infinity);
    if (!manifest)
      return {
        done: false,
        result: noAnswer(first.run, printed, [join(run, "snapshot"), root]),
      };
    handed = manifest.path;
  }
  // The second run: the harness alone, given only what the first wrote.
  const out = join(run, "out");
  await mkdir(out, { recursive: true });
  const left = Math.max(1000, timeMs - (Date.now() - began));
  const request = join(run, "request.json");
  await writeFile(
    request,
    JSON.stringify({
      ...(options.lines ? { lines: options.lines } : { parts: handed }),
      ...measuring(prepared, out, left / 1000, options.preview),
    }),
    "utf8",
  );
  const second = await python.run({
    // Isolated: nothing of the workspace on its path, nor of its environment.
    arguments: ["-I", "-X", "utf8", harness, request],
    cwd: out,
    read: [dirname(harness), ...(handed ? [scripted] : []), run],
    write: [out],
    home: join(run, "measuring-home"),
    homeLastsOneRun: true,
    timeoutMs: left,
    ...signal,
  });
  if (!second.ok)
    return { done: false, result: textResult(second.reason, true) };
  if (second.run.exitCode === null)
    return {
      done: false,
      result: unfinished(
        tool,
        second.run,
        timeMs,
        [handed ? await progressIn(scripted) : "", await progressIn(out)]
          .filter(Boolean)
          .join("\n"),
        printed,
      ),
    };
  const answer =
    tool === "cad_draw"
      ? await answerIn(out, "drawing")
      : await answerIn(out, "build");
  if (!answer)
    return {
      done: false,
      result: noAnswer(second.run, printed, [join(run, "snapshot"), root]),
    };
  if ("failed" in answer)
    return {
      done: false,
      result: textResult(
        [
          answer.failed,
          "outOfTime" in answer &&
            answer.outOfTime &&
            moreTime("drawing", timeMs),
          printed.trim() && `What the script printed:\n${printed.trim()}`,
        ]
          .filter(Boolean)
          .join("\n"),
        true,
      ),
    };
  return { done: true, out, answer, printed, changes: breakLines(warned) };
}
