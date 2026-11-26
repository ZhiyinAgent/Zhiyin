/**
 * One call as Blender will run it and as a person approves it, prepared by
 * its tool. Opening a scene and looking up the API need no open scene, and a
 * description asked for with none open says so; every other tool works on
 * the scene open in this workspace.
 */

import type { Refusal } from "./paths.js";
import type { SceneSession } from "./scene-session.js";
import type { Args, Prepared, Preparer } from "./prepared-call.js";
import { prepareLookUp, prepareOpen } from "./sceneless-calls.js";
import {
  prepareCloseUps,
  prepareDescribe,
  prepareFrameSheet,
  prepareLook,
} from "./looking-calls.js";
import { prepareExport, prepareRender, prepareVideo } from "./output-calls.js";
import {
  prepareAdd,
  prepareAnimate,
  prepareCamera,
  prepareEdit,
  prepareLighting,
  prepareMaterial,
  prepareSettle,
  prepareShape,
} from "./change-calls.js";
import { prepareScript } from "./script-call.js";
import { timeLimits } from "./time-limits.js";
import { prepareDecal } from "./decal-calls.js";
import { prepareRig } from "./rig-calls.js";
import { prepareSimulate } from "./simulate-calls.js";
import { prepareMeasure } from "./measure-calls.js";
import { prepareScatter } from "./scatter-calls.js";
import { prepareBake, prepareUnwrap } from "./uv-calls.js";

const noScene: Refusal = {
  reason: "No scene is open. Open or create one with blender_open_scene first.",
  correctable: true,
};

/** A description asked for with no scene open, answered without Blender. */
const describedWithoutScene = (why: string | undefined): Prepared => ({
  command: "describe",
  args: {},
  timeoutMs: timeLimits.describe,
  action: "Describe a 3D scene",
  target: "no scene",
  rows: [],
  access: "read",
  answer: `${why ? `${why} ` : ""}No scene is open, so there is nothing to describe. Open or create one with blender_open_scene.`,
});

/** The tools that work on the open scene, each by how it prepares its call. */
const onScene: Readonly<Record<string, Preparer>> = {
  blender_describe_scene: prepareDescribe,
  blender_render: prepareRender,
  blender_frame_sheet: prepareFrameSheet,
  blender_close_ups: prepareCloseUps,
  blender_look: prepareLook,
  blender_render_video: prepareVideo,
  blender_export: prepareExport,
  blender_add_objects: prepareAdd,
  blender_edit_objects: prepareEdit,
  blender_shape_objects: prepareShape,
  blender_set_material: prepareMaterial,
  blender_set_camera: prepareCamera,
  blender_set_lighting: prepareLighting,
  blender_run_script: prepareScript,
  blender_animate: prepareAnimate,
  blender_settle_objects: prepareSettle,
  blender_scatter: prepareScatter,
  blender_measure: prepareMeasure,
  blender_unwrap: prepareUnwrap,
  blender_bake: prepareBake,
  blender_add_decal: prepareDecal,
  blender_rig: prepareRig,
  blender_simulate: prepareSimulate,
};

/**
 * One call as Blender will run it and as a person approves it. Every path is
 * checked here, once, for both: what is approved is what runs.
 */
export async function prepare(
  name: string,
  args: Args,
  root: string,
  session: SceneSession,
  protect: readonly string[],
): Promise<Prepared | Refusal> {
  if (name === "blender_open_scene") return prepareOpen(args, root);
  if (name === "blender_api") return prepareLookUp(args);
  // A scene opened in a folder the conversation has since left is not this
  // workspace's: nothing here changes it.
  const scene = await session.sceneIn(root);
  if (!scene) {
    const why = session.whyNoScene();
    // Asked to describe, that none is open is the description.
    if (name === "blender_describe_scene") return describedWithoutScene(why);
    return why ? { ...noScene, reason: `${why} ${noScene.reason}` } : noScene;
  }
  const preparer = Object.hasOwn(onScene, name) ? onScene[name] : undefined;
  if (!preparer)
    return {
      reason: `The tool “${name}” is not available.`,
      correctable: false,
    };
  return preparer(args, { root, scene, protect });
}
