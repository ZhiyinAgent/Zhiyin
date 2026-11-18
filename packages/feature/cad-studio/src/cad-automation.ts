/**
 * The CAD studio's tools on one conversation's folder: a call's script runs
 * in a folder of the run's own, reading the workspace and writing only
 * there, and the exports the call named are copied into the workspace once it
 * ends, at the paths that were approved (ADR 0023).
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ActionDetail,
  FileChange,
  PreviewedPart,
  ProducedFile,
  SceneLines,
  WritingConnection,
} from "@zhiyin/contract";
import { replaceFile, WrittenFiles } from "@zhiyin/files";
import type { CadPython } from "./cad-python.js";
import { cadTools } from "./tools.js";
import {
  isPng,
  largestPicture,
  largestPreview,
  plainFile,
  previewFile,
} from "./run-answer.js";
import { builtText, drawnText } from "./wording.js";
import { callRows, outsideWords, writtenWords } from "./call-rows.js";
import { listed, shownNames } from "./shown-names.js";
import { withMaterials } from "./drawing-materials.js";
import { DrawingRecord, requestOf } from "./drawing-record.js";
import { viewNames } from "./drawing-request.js";
import { inFileOrder } from "./requirements-request.js";
import { minutes, moreTime, timeFor } from "./run-time.js";
import {
  Margins,
  requirementsDetail,
  requirementsText,
} from "./requirements-answer.js";
import {
  BuildRecord,
  changeLines,
  staleLines,
  unchangedSince,
} from "./build-record.js";
import { PartReviews } from "./part-reviews.js";
import {
  keptOf,
  type Last,
  type Requirement,
} from "@zhiyin/studio-requirements";
import {
  identityOf,
  isTool,
  prepare,
  type Args,
  type Prepared,
} from "./call-preparation.js";
import { inspectLookUp, lookUp, runLookUp } from "./library-look-up.js";
import { answerText, textResult } from "./tool-result.js";
import { notInstalled } from "./environment-words.js";
import { removeHeldRuns, removeRun } from "./run-folders.js";
import { delivered } from "./delivery.js";
import { runBuild } from "./build-run.js";

export type CadAutomationOptions = {
  readonly workspaceRoot: () => string | undefined;
  /** The harness the studio runs, `run.py`, shipped with the app. */
  readonly harness: string;
  /** The studio's folder in the app's data, where each run keeps its files. */
  readonly directory: string;
  /**
   * Shows the parts a build made beside the conversation: given the mesh the
   * build wrote, still in its run's folder, so it is read before it returns.
   */
  readonly preview?: (
    model: string,
    parts: readonly PreviewedPart[],
    script?: string,
  ) => Promise<void>;
  /**
   * The conversation's Blender scene, which a drawing can be of instead of
   * parts: Blender finds its lines and the drafting draws them (ADR 0022).
   */
  readonly sceneLines?: SceneLines;
  /** How long one build or drawing may run: five minutes unless a test gives less. */
  readonly buildTimeMs?: number;
  /**
   * Zhiyin's own folders, its data and its program, which no file a call
   * writes may be in, whatever the person would approve (ADR 0012).
   */
  readonly protect?: readonly string[];
};

const noFolder = "Choose a folder before building a CAD part.";

/** The model's CAD tools on one conversation's folder. */
export function cadAutomation(
  python: CadPython,
  options: CadAutomationOptions,
): WritingConnection {
  /** How long a call may run when the model gives no minutes. */
  const usualTime = options.buildTimeMs ?? minutes(5);
  const wrote = new WeakMap<object, readonly ProducedFile[]>();
  // The requirements as checked, for the person's view of the answer that says them.
  const checkedBy = new WeakMap<object, ActionDetail>();
  const ownFiles = new WrittenFiles(
    join(options.directory, "written.json"),
    replaceFile,
  );
  const drawings = new DrawingRecord(join(options.directory, "drawings.json"));
  const margins = new Margins(join(options.directory, "requirements.json"));
  // What a reviewer of each design is handed (ADR 0024).
  const reviews = new PartReviews(() => options.directory);
  const builds = new BuildRecord(join(options.directory, "builds.json"));
  /** The run folders of calls under way, which no other call removes. */
  const running = new Set<string>();
  // A parts list gives the title block's material only to parts made a
  // known way: the parts earlier builds of the script wrote for printing
  // are printed, as they were to those builds.
  const printedFor = async (prepared: Prepared) => {
    if (!prepared.drawing?.["parts_list"] || !prepared.file) return {};
    const printed = await builds.printed(prepared.file.relative);
    return printed.length ? { drawing: { ...prepared.drawing, printed } } : {};
  };
  /** The call, each file it replaces said to be one of this conversation's own or not. */
  const owning = async <T extends Prepared | { reason: string }>(
    prepared: T,
  ): Promise<T> =>
    "reason" in prepared
      ? prepared
      : {
          ...prepared,
          exports: await Promise.all(
            (prepared as Prepared).exports.map(async (one) => ({
              ...one,
              own: one.exists && (await ownFiles.unchanged(one.absolute)),
            })),
          ),
          ...(await printedFor(prepared as Prepared)),
        };
  return {
    /** Asked again every look, so installing the studio is noticed without a restart. */
    async listTools() {
      if ((await python.state()) !== "ready") throw new Error(notInstalled);
      return cadTools;
    },

    async inspect(name, args) {
      if (name === lookUp) return inspectLookUp(args, python);
      if (!isTool(name))
        return { ok: false, reason: `The tool “${name}” is not available.` };
      const root = options.workspaceRoot();
      if (!root) return { ok: false, reason: noFolder };
      if ((await python.state()) !== "ready")
        return { ok: false, reason: notInstalled };
      const asked = await requestOf(drawings, args);
      if (!asked.ok)
        return { ok: false, reason: asked.reason, correctable: true };
      const given =
        name === "cad_draw"
          ? await withMaterials(drawings, root, asked.args)
          : { args: asked.args };
      const prepared = await owning(
        await prepare(
          root,
          given.args,
          name,
          options.sceneLines,
          options.protect,
        ),
      );
      if ("reason" in prepared)
        return {
          ok: false,
          reason: prepared.reason,
          ...(prepared.correctable ? { correctable: true as const } : {}),
        };
      const writes = prepared.exports.map((one) => one.relative);
      // A file this conversation's builds wrote, unchanged since, is theirs to replace.
      const replaces = prepared.exports.some((one) => one.exists && !one.own);
      // Files outside the workspace, each named by its whole real path, which
      // only a grant for that file or its folder covers (ADR 0012).
      const outside = prepared.exports.filter((one) => one.outside);
      const changes: FileChange[] = prepared.exports.map((one) => ({
        path: one.relative,
        change: one.exists ? "updated" : "created",
        omitted: writtenWords(one, prepared.tool === "cad_draw"),
      }));
      // What the call is about: the scene, the script's file, else the
      // parts it draws or shows by name, else the files it writes.
      const chosen = prepared.drawing?.["parts"];
      const parts = Array.isArray(chosen)
        ? chosen.filter((part): part is string => typeof part === "string")
        : shownNames(prepared.code);
      const several = parts.length > 1;
      const action = prepared.scene
        ? "Draw a 3D scene"
        : name === "cad_draw"
          ? several
            ? "Draw CAD parts"
            : "Draw a CAD part"
          : several
            ? "Build CAD parts"
            : "Build a CAD part";
      return {
        ok: true,
        action,
        target:
          prepared.scene ??
          prepared.file?.relative ??
          (listed(parts) || listed(writes) || "a script"),
        // Whole: what is approved is what runs.
        command: prepared.scene
          ? `${name}(${JSON.stringify(args)})`
          : prepared.code,
        invocation: {
          name: action,
          arguments: callRows({
            code: prepared.code,
            ...(prepared.file ? { file: prepared.file.relative } : {}),
            arguments: prepared.positions ? [] : prepared.arguments,
            ...(prepared.positions ? { positions: prepared.positions } : {}),
            ...(prepared.explode ? { explode: prepared.explode } : {}),
            ...(prepared.drawing ? { drawing: prepared.drawing } : {}),
            ...(prepared.scene ? { scene: prepared.scene } : {}),
            ...(prepared.minutes !== undefined
              ? { minutes: prepared.minutes }
              : {}),
          }),
        },
        detail: [
          ...(outside.length ? [outsideWords(outside)] : []),
          prepared.scene
            ? `Blender reads the scene and leaves it as it was. Zhiyin writes only ${writes.join(", ")}.`
            : writes.length
              ? `The script reads the workspace and cannot use the internet. Zhiyin writes only ${writes.join(", ")}.`
              : "The script reads the workspace and cannot use the internet. Nothing is written.",
        ].join(" "),
        // The build runs confined, reading the workspace; it changes only
        // the files Zhiyin writes from it, declared, so they can be put back.
        effects: {
          reads: "workspace",
          changes: outside.length
            ? "elsewhere"
            : writes.length
              ? "workspace"
              : "none",
          sends: "none",
          actsAsPerson: "none",
          runs: "sealed",
          lasting: false,
          brings: "none",
        },
        ...(changes.length ? { changes } : {}),
        // Builds that write no file over another but their own are one set
        // the person can allow for the conversation; one that replaces any
        // other file, or writes outside the workspace, is asked about.
        ...(replaces || outside.length
          ? {}
          : {
              allowance: {
                key: JSON.stringify({ workspace: root, cad: name }),
                label:
                  name === "cad_draw"
                    ? "CAD drawings that read the workspace and write only new files, or files they wrote before"
                    : "CAD builds that read the workspace and write only new files, or files they wrote before",
              },
            }),
        boundToCall: true,
        identity: identityOf(prepared),
      };
    },

    async callTool(name, args, signal, binding) {
      if (name === lookUp)
        return runLookUp(
          args,
          python,
          options.harness,
          options.directory,
          signal,
        );
      if (!isTool(name)) return textResult(`Unknown tool “${name}”.`, true);
      const root = options.workspaceRoot();
      if (!root) return textResult(noFolder, true);
      const asked = await requestOf(drawings, args);
      if (!asked.ok) return textResult(asked.reason, true);
      // A parts list given no materials takes those found for it, which the answer says.
      const given =
        name === "cad_draw"
          ? await withMaterials(drawings, root, asked.args)
          : { args: asked.args };
      const prepared = await owning(
        await prepare(
          root,
          given.args,
          name,
          options.sceneLines,
          options.protect,
        ),
      );
      if ("reason" in prepared) return textResult(prepared.reason, true);
      const buildTime = timeFor(prepared.minutes, usualTime);
      // A file changed, or an export that appeared, since the approval is
      // not what was approved.
      if (binding !== undefined && binding !== identityOf(prepared))
        return textResult(
          `${prepared.scene ? "The scene open in this conversation or the files the drawing writes" : "The script or the files it writes"} changed after this ${name === "cad_draw" ? "drawing" : "build"} was approved, so it did not run. Ask again to approve it as it is now.`,
          true,
        );
      const run = join(options.directory, "runs", randomUUID());
      running.add(run);
      await removeHeldRuns(join(options.directory, "runs"), running);
      await mkdir(run, { recursive: true });
      try {
        let lines: string | undefined;
        if (prepared.scene && prepared.drawing && options.sceneLines) {
          const asked = prepared.drawing["views"] as readonly Args[];
          const found = await options.sceneLines.lines(
            {
              ...(prepared.drawing["objects"]
                ? { objects: prepared.drawing["objects"] as string[] }
                : {}),
              views: asked.length
                ? asked
                : viewNames(prepared.drawing).map((view) => ({ view })),
            },
            { workspace: root, ...(signal ? { signal } : {}) },
          );
          if (!found.ok) return textResult(found.reason, true);
          lines = join(run, "lines.json");
          await writeFile(lines, found.lines, "utf8");
        }
        const ran = await runBuild({
          python,
          harness: options.harness,
          root,
          run,
          prepared,
          ...(lines ? { lines } : {}),
          timeMs: buildTime,
          preview: options.preview !== undefined,
          ...(signal ? { signal } : {}),
        });
        if (!ran.done) return ran.result;
        const { out, answer, printed, changes: apiChanges } = ran;
        const { written, notWritten, files, placed } = await delivered(
          root,
          out,
          prepared,
          answer,
          ownFiles,
          options.protect ?? [],
        );
        // A drawing's request, kept by the files it wrote, to draw it again.
        if ("drawing" in answer && written.length)
          await drawings.drew(
            written.map((one) => one.relative),
            given.args,
          );
        const pictureFile = ("drawing" in answer ? answer.drawing : answer)
          .picture
          ? await plainFile(out, "picture.png", largestPicture)
          : undefined;
        const picture = pictureFile
          ? await readFile(pictureFile.path).catch(() => undefined)
          : undefined;
        const drawn = picture !== undefined && isPng(picture);
        // A build is told apart from another by its script's file and its
        // arguments, or as code given in the call.
        const runArguments = prepared.positions?.[0] ?? prepared.arguments;
        const script = JSON.stringify([
          prepared.file?.relative.toLowerCase() ?? null,
          runArguments,
        ]);
        // A design is its script's file, whatever its arguments, or code given
        // in the call.
        const design = prepared.file?.relative.toLowerCase() ?? "";
        // The requirements as checked, each margin beside the last build of
        // the same design's, then kept for the next.
        const checks: string[] = [];
        let checksShown: ActionDetail | undefined;
        let reviewed:
          | {
              readonly file: string;
              readonly requirements: readonly Requirement[];
              readonly last: Readonly<Record<string, Last>>;
            }
          | undefined;
        const unreadable = prepared.unreadableRequirements;
        if (unreadable && !("drawing" in answer)) {
          checks.push(
            `No requirement was checked: ${unreadable.reason} Fix the file, and the next build checks it.`,
          );
          checksShown = {
            kind: "checks",
            label: `Requirements in ${unreadable.file}`,
            items: [
              { label: unreadable.file, holds: null, note: unreadable.reason },
            ],
          };
        }
        if (prepared.requirements && !("drawing" in answer)) {
          const { file, list } = prepared.requirements;
          const checked = inFileOrder(list, answer.requirements ?? []);
          const says = Object.fromEntries(
            list.map((one) => [
              one.id,
              typeof one["says"] === "string" ? one["says"] : undefined,
            ]),
          );
          const last = await margins.last(file, design);
          checks.push(...requirementsText(file, checked, says, last));
          checksShown = requirementsDetail(file, checked, says, last);
          await margins.keep(file, design, checked, says);
          reviewed = { file, requirements: list, last: keptOf(checked, says) };
        }
        // How each part changed since the last build of the same script,
        // and the files earlier builds of it wrote whose parts have changed
        // since; then this build is kept for the next.
        const changes: string[] = [];
        const stale: string[] = [];
        let unchanged: string[] = [];
        let named = "";
        if (!("drawing" in answer) && answer.parts.length) {
          named = `${prepared.file?.relative ?? "code given in the call"}${runArguments.length ? " with the same arguments" : ""}`;
          // Code given in the call is another design when it shows no part
          // of the same name as the last build of code.
          const last = await builds.last(script);
          const same =
            prepared.file !== undefined ||
            !last ||
            answer.parts.some((part) => Object.hasOwn(last, part.name));
          changes.push(
            ...changeLines(named, same ? last : undefined, answer.parts),
          );
          unchanged = unchangedSince(same ? last : undefined, answer.parts);
          stale.push(
            ...staleLines(await builds.stale(script, answer.parts, placed)),
          );
          await builds.keep(script, answer.parts, placed);
        }
        const content: {
          type: string;
          text?: string;
          data?: string;
          mimeType?: string;
        }[] = [
          {
            type: "text",
            // What each pattern named comes first, so what it stood for is never left to guess.
            text: [
              ...(given.said ? [given.said] : []),
              ...(("drawing" in answer
                ? answer.drawing.patterns
                : answer.patterns) ?? []),
              "drawing" in answer
                ? drawnText(
                    answer.drawing,
                    written,
                    notWritten,
                    printed,
                    drawn,
                    answer.drawing.leftOut
                      ? moreTime("drawing", buildTime)
                      : undefined,
                  )
                : builtText(answer, written, notWritten, printed, drawn, {
                    changes,
                    stale,
                    unchanged,
                    script: named,
                  }),
              ...checks,
              ...apiChanges,
            ].join("\n"),
          },
        ];
        if (drawn)
          content.push({
            type: "image",
            data: picture.toString("base64"),
            mimeType: "image/png",
          });
        if (!("drawing" in answer) && answer.preview && options.preview) {
          const model = await plainFile(out, previewFile, largestPreview);
          // The view beside the conversation is the person's; a preview that
          // cannot be shown leaves the build's answer as it is.
          if (model)
            await options
              .preview(
                model.path,
                answer.parts.map((part) => ({
                  name: part.name,
                  size: part.size,
                  valid: part.valid,
                })),
                prepared.file?.relative,
              )
              .catch(() => undefined);
        }
        if (reviewed)
          await reviews.built(options.directory, {
            design,
            ...reviewed,
            answer: content[0]?.text ?? "",
            ...(drawn ? { picture } : {}),
            at: new Date(),
          });
        const result = { content };
        if (files.length) wrote.set(result, files);
        if (checksShown) checkedBy.set(result, checksShown);
        return result;
      } finally {
        await removeRun(run);
        running.delete(run);
      }
    },

    describeResult(_name, _args, result) {
      if (!result.ok)
        return [
          {
            kind: "text",
            label: "The CAD studio's answer",
            text: result.reason,
          },
        ];
      const answer = answerText(result.value);
      const checked =
        result.value && typeof result.value === "object"
          ? checkedBy.get(result.value)
          : undefined;
      return [
        ...(checked ? [checked] : []),
        ...(answer
          ? [
              {
                kind: "text" as const,
                label: "The CAD studio's answer",
                text: answer,
              },
            ]
          : []),
      ];
    },

    produced(_name, _args, value) {
      return value && typeof value === "object" ? (wrote.get(value) ?? []) : [];
    },

    async close() {},
  };
}

/** The studio's tools, for a connection that is not opened yet. */
export async function describeCadTools(python: CadPython) {
  if ((await python.state()) !== "ready") throw new Error(notInstalled);
  return cadTools;
}
