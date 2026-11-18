/**
 * The 3D studio's tools on one conversation's scene: each call is prepared
 * once, for the approval and for the run, runs in the conversation's Blender,
 * and what it wrote is delivered to the places that were approved.
 */

import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  ActionDetail,
  ProducedFile,
  WritingConnection,
} from "@zhiyin/contract";
import { replaceFile, WrittenFiles } from "@zhiyin/files";
import { approvalOf, identityOf } from "./call-approval.js";
import { prepare } from "./call-preparation.js";
import { delivered, type Delivered } from "./delivery.js";
import { notInstalled } from "./environment-words.js";
import type { Prepared } from "./prepared-call.js";
import { answerContent } from "./run-answer.js";
import type { SceneSession } from "./scene-session.js";
import { removeRun, runCall, runFolders } from "./scene-run.js";
import { SceneSpecs, type SpecSaid } from "./scene-spec.js";
import { resultDetails, textResult } from "./tool-result.js";
import { sceneWork } from "./toolkits.js";
import { studioTools } from "./tools.js";

/** What a run delivered, less the files it left as they were before `began`. */
async function writtenSince(
  made: Delivered,
  began: number,
): Promise<Pick<Delivered, "placed" | "files">> {
  const placed = [];
  for (const file of made.placed) {
    const changed = (await stat(file.absolute).catch(() => undefined))?.mtimeMs;
    // A second's slack for file times coarser than the clock.
    if (changed !== undefined && changed >= began - 1_000) placed.push(file);
  }
  const kept = new Set(placed.map((file) => file.relative));
  return {
    placed,
    files: made.files.filter((file) => kept.has(file.path)),
  };
}

/** The programs the 3D studio needs installed before it can run, by toolchain id. */
export const scenePrograms = ["blender"] as const;

export type SceneAutomationOptions = {
  readonly workspaceRoot: () => string | undefined;
  /** The installed Blender, or nothing; no Blender, no tools. */
  readonly blender: () => Promise<string | undefined>;
  /** This conversation's own folder in the app's data. */
  readonly directory: string;
  /**
   * Hands over a video Blender rendered, for the person to watch: given the
   * file in the workspace, which it must read before it returns.
   */
  readonly video?: (file: {
    readonly absolute: string;
    readonly relative: string;
  }) => Promise<void>;
  /** Zhiyin's own folders, which no tool writes, whatever is approved. */
  readonly protect?: readonly string[];
  /**
   * Whether sealed-off programs are held from changing a path for the run
   * going on (ADR 0012). What a script made for a folder outside the
   * workspace is moved only where the script could have written it itself;
   * absent, nothing is held.
   */
  readonly held?: (path: string) => Promise<boolean>;
};

const noFolder = "Choose a folder before working on a 3D scene.";

/** The model's tools on one conversation's scene. */
export function sceneAutomation(
  session: SceneSession,
  options: SceneAutomationOptions,
): WritingConnection {
  const wrote = new WeakMap<object, readonly ProducedFile[]>();
  // The spec's verdicts, for the person's view of the answer that says them.
  const specShown = new WeakMap<object, ActionDetail>();
  const specs = new SceneSpecs(options.directory);
  const ownFiles = new WrittenFiles(
    join(options.directory, "written.json"),
    replaceFile,
  );
  /** Each file a call writes over, said to be one this conversation's calls wrote, unchanged since, or not. */
  const owned = (prepared: Prepared) =>
    Promise.all(
      (prepared.written ?? []).map(
        async (file) =>
          file.exists && (await ownFiles.unchanged(file.absolute)),
      ),
    );
  const protect = options.protect ?? [];
  // The folder as the file system names it: a confined Blender cannot always
  // expand an 8.3 short name such as RUNNER~1, so the two names of one folder
  // would not match when a model file's path is checked against it.
  const workspaceRoot = () => {
    const root = options.workspaceRoot();
    if (!root) return undefined;
    try {
      return realpathSync.native(root);
    } catch {
      return root;
    }
  };
  return {
    /** Asked again every look, so installing Blender is noticed without a restart. */
    async listTools() {
      if (!(await options.blender())) throw new Error(notInstalled);
      return studioTools;
    },

    async inspect(name, args) {
      const root = workspaceRoot();
      if (!root) return { ok: false, reason: noFolder };
      if (!(await options.blender()))
        return { ok: false, reason: notInstalled };
      const prepared = await prepare(name, args, root, session, protect);
      if ("reason" in prepared)
        return {
          ok: false,
          reason: prepared.reason,
          ...(prepared.correctable ? { correctable: true } : {}),
        };
      return approvalOf(
        name,
        args,
        root,
        prepared,
        await session.sceneIn(root),
        await owned(prepared),
      );
    },

    async callTool(name, args, signal, binding) {
      const root = workspaceRoot();
      if (!root) return textResult(noFolder, true);
      const prepared = await prepare(name, args, root, session, protect);
      if ("reason" in prepared) return textResult(prepared.reason, true);
      // A file written or changed since the call was approved is not what was approved.
      if (
        binding !== undefined &&
        binding !==
          identityOf(
            name,
            prepared,
            await session.sceneIn(root),
            await owned(prepared),
          )
      )
        return textResult(
          "The scene or a file this call writes changed after it was approved, so it did not run. Ask again to approve it as it is now.",
          true,
        );
      const run = runFolders(prepared, options.directory);
      const spec = await specs.before(
        prepared.command,
        root,
        prepared.opening?.relative ?? (await session.sceneIn(root)),
      );
      let said: readonly string[];
      let made: Delivered;
      let measured: SpecSaid;
      // A video drawn over several calls is written only by the last: the
      // others leave a file already there as it was.
      const began = Date.now();
      try {
        const ran = await runCall(
          session,
          prepared,
          root,
          run,
          signal,
          specs.sent(spec),
        );
        if (!ran.done) {
          await specs.discard(spec);
          return ran.result;
        }
        measured = await specs.after(spec);
        made = await delivered({
          run,
          prepared,
          root,
          protect,
          held: options.held,
          ownFiles,
        });
        said = [
          ...ran.said,
          ...made.said,
          ...measured.lines,
          ...(prepared.command === "open" ? [sceneWork] : []),
        ];
      } finally {
        await removeRun(run);
      }
      const content = await answerContent(
        said,
        run.picture ?? measured.picture,
        prepared.command === "describe" ? session.state().preview : undefined,
      );
      // The person watches what was rendered; a video that cannot be handed
      // over is still written, and opens in its own app.
      const fresh =
        prepared.command === "video" ? await writtenSince(made, began) : made;
      if (prepared.command === "video" && options.video)
        for (const file of fresh.placed)
          await options.video(file).catch(() => undefined);
      const result = { content, ...(made.unwritten ? { isError: true } : {}) };
      if (fresh.files.length) wrote.set(result, fresh.files);
      if (measured.detail) specShown.set(result, measured.detail);
      return result;
    },

    describeResult(name, _args, result) {
      const shown =
        result.ok && result.value && typeof result.value === "object"
          ? specShown.get(result.value)
          : undefined;
      return [...(shown ? [shown] : []), ...resultDetails(name, result)];
    },

    produced(_name, _args, value) {
      return value && typeof value === "object" ? (wrote.get(value) ?? []) : [];
    },

    async close() {},
  };
}
