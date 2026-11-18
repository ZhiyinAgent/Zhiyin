/**
 * A prepared call as the session runs it. Blender's confinement is fixed as
 * it starts and reaches only the workspace, so what goes outside the
 * workspace it writes in a staging folder of the conversation's own, which
 * Zhiyin then moves into place; the smaller picture the model sees goes in
 * the conversation's own folder too, chosen only now.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { changesSaid } from "./api-breaks.js";
import { folderFor } from "./paths.js";
import type { Prepared } from "./prepared-call.js";
import { quietSaid } from "./quiet-changes.js";
import type { SceneSession } from "./scene-session.js";
import type { SpecSent } from "./scene-spec.js";
import { stagingFolder } from "./session-process.js";
import { textResult } from "./tool-result.js";

/** Where one run's files go before they are delivered. */
export type RunFolders = {
  /** The picture Blender writes for the model to see, if the call has one. */
  readonly picture?: string;
  /** The run's staging folder, when anything goes outside the workspace. */
  readonly staging?: string;
  /** Where Blender writes each file the call writes outside the workspace, by its order. */
  readonly staged: readonly (string | undefined)[];
  /** Each folder outside the workspace a script may write, and where it writes it instead. */
  readonly folders: readonly {
    readonly folder: string;
    readonly staging: string;
  }[];
};

/** What a run came to: what Blender said, or the call's answer already, as a failure. */
export type Ran =
  | { readonly done: true; readonly said: readonly string[] }
  | { readonly done: false; readonly result: ReturnType<typeof textResult> };

/** The folders a run of `prepared` uses, in this conversation's `directory`. */
export function runFolders(prepared: Prepared, directory: string): RunFolders {
  const written = prepared.written ?? [];
  const elsewhere = prepared.outsideFolders ?? [];
  const staging =
    elsewhere.length || written.some((file) => file.outside)
      ? join(stagingFolder(directory), randomUUID())
      : undefined;
  return {
    ...(prepared.picture
      ? { picture: join(directory, "pictures", `${randomUUID()}.jpg`) }
      : {}),
    ...(staging ? { staging } : {}),
    staged: written.map((file, index) =>
      file.outside && staging
        ? join(staging, String(index), basename(file.absolute))
        : undefined,
    ),
    folders: elsewhere.map((folder, index) => ({
      folder,
      staging: join(staging ?? "", `folder-${index}`),
    })),
  };
}

/**
 * Runs the call in the session, its files written where `run` says, and the
 * scene measured after it against the `spec` given.
 */
export async function runCall(
  session: SceneSession,
  prepared: Prepared,
  root: string,
  run: RunFolders,
  signal: AbortSignal | undefined,
  spec?: SpecSent,
): Promise<Ran> {
  for (const file of prepared.written ?? [])
    if (!file.outside) await folderFor(file.absolute);
  if (run.picture) await mkdir(dirname(run.picture), { recursive: true });
  const sent: Record<string, unknown> = { ...prepared.args };
  if (run.picture) sent["picture"] = run.picture;
  const stagedOutput = run.staged.find((path) => path !== undefined);
  if (stagedOutput) sent["output"] = stagedOutput;
  if (run.folders.length) sent["outside"] = run.folders;
  if (spec) sent["spec"] = spec;
  for (const folder of [
    ...run.staged.flatMap((one) => (one ? [dirname(one)] : [])),
    ...run.folders.map((one) => one.staging),
  ])
    await mkdir(folder, { recursive: true });
  // What a script's own lines meet that Blender 5.2 runs without an error, read before it runs.
  const quiet =
    prepared.command === "script" && typeof prepared.args["code"] === "string"
      ? quietSaid(prepared.args["code"])
      : "";
  const outcome = await session.run(prepared.command, sent, {
    timeoutMs: prepared.timeoutMs,
    workspace: root,
    ...(signal ? { signal } : {}),
    ...(prepared.opening ? { opening: prepared.opening } : {}),
  });
  if (!outcome.ok) {
    if (run.picture) await rm(run.picture, { force: true });
    // A script written for an earlier Blender is told what 5.2 changed.
    const changed =
      prepared.command === "script" ? changesSaid(outcome.reason) : "";
    const said = [
      outcome.reason,
      ...(changed ? [changed] : []),
      ...(quiet ? [quiet] : []),
      ...(run.folders.length
        ? [
            `Nothing it made for ${run.folders.map((one) => one.folder).join(" or ")} was moved there.`,
          ]
        : []),
    ];
    return { done: false, result: textResult(said.join("\n"), true) };
  }
  return {
    done: true,
    said: [outcome.text, ...outcome.notes, ...(quiet ? [quiet] : [])],
  };
}

/** Removes what the run staged, delivered or not. */
export async function removeRun(run: RunFolders): Promise<void> {
  if (run.staging) await rm(run.staging, { recursive: true, force: true });
}
