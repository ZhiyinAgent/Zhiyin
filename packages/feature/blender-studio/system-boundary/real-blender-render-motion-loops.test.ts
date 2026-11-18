/**
 * What a motion does past its keys, against a real Blender: holding, carrying
 * on at its end speeds, repeating its keys round seamlessly, repeating each
 * round on from the last as a wheel turns, and playing back and forth; each
 * answer says whether a round ends where it starts, moving as it does there.
 * A timeline keyed as a loop says whether it plays round.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  ConversationScenes,
  containedSessionLaunch,
  sceneAutomation,
} from "../src/index.js";

const blender = process.env["ZHIYIN_BLENDER"];
const sessionScript = fileURLToPath(
  new URL("../src/session/start.py", import.meta.url),
);
type Result = {
  isError?: boolean;
  content: { type: string; text?: string }[];
};

const cube = (name: string, location: number[]) => ({
  name,
  kind: "cube",
  size: [0.2, 0.2, 0.2],
  location,
});

describe.runIf(blender)("motion past its keys in a real Blender", () => {
  const folders = new TemporaryFolders();
  let scenes: ConversationScenes;
  let tools: ReturnType<typeof sceneAutomation>;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await tools.callTool(name, args)) as Result;
    return {
      failed: result.isError === true,
      said: result.content.map((c) => c.text ?? "").join("\n"),
    };
  };
  const done = async (name: string, args: Record<string, unknown>) => {
    const result = await call(name, args);
    expect(result.failed, result.said).toBe(false);
    return result.said;
  };
  /** An object's place along x and turn round z, in degrees, at a time. */
  const at = async (name: string, seconds: number) => {
    const said = await done("blender_run_script", {
      code: [
        "import bpy, math",
        "s = bpy.context.scene",
        `f = s.frame_start + ${seconds} * s.render.fps`,
        "s.frame_set(int(f), subframe=f - int(f))",
        `o = bpy.data.objects['${name}']`,
        "print(f'x {o.location.x:.3f} z {o.location.z:.3f} turn {math.degrees(o.rotation_euler.z):.1f}')",
        "s.frame_set(s.frame_start)",
      ].join("\n"),
    });
    return /x -?[\d.]+ z -?[\d.]+ turn -?[\d.]+/.exec(said)?.[0];
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-loops-");
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    scenes = new ConversationScenes({
      blender: async () => blender,
      directory: join(root, "data"),
      launch: containedSessionLaunch(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts") },
      ),
      script: sessionScript,
    });
    tools = sceneAutomation(scenes.scene("loops"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("loops"),
    });
    await call("blender_open_scene", { path: "loops.blend", create: true });
    await done("blender_add_objects", {
      objects: [
        cube("Fan", [0, 0, 1]),
        cube("Bob", [1, 0, 0]),
        cube("Slider", [2, 0, 1]),
        cube("Cart", [3, 0, 1]),
        cube("Door", [4, 0, 1]),
      ],
    });
  });

  afterAll(async () => {
    await scenes.forget("loops");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("repeats a smooth turn on from each round at one even speed, and a bob round with no jump", async () => {
    const said = await done("blender_animate", {
      keys: [
        { object: "Fan", at: 0, rotation: [0, 0, 0] },
        { object: "Fan", at: 1, rotation: [0, 0, 360] },
        { object: "Bob", at: 0, location: [1, 0, 0] },
        { object: "Bob", at: 0.5, location: [1, 0, 1] },
        { object: "Bob", at: 1, location: [1, 0, 0] },
      ],
      extend: [
        { object: "Fan", mode: "repeat_on" },
        { object: "Bob", mode: "repeat" },
      ],
    });

    expect(said).toContain(
      "Fan: 0 s: turned (0°, 0°, 0°); 1 s: turned (0°, 0°, 360°); repeats its keys from 0 s to 1 s, a round every 1 s, each round going on from where the last ended, 360° round z further: where a round ends and the next begins it moves on at the same speed and turn, with no jump.",
    );
    expect(said).toContain(
      "repeats its keys from 0 s to 1 s, a round every 1 s: where a round ends and the next begins it moves on at the same speed and turn, with no jump.",
    );
    // Turning on at one speed: a quarter of a round is a quarter turn, and past its keys it keeps on.
    expect(await at("Fan", 0.25)).toBe("x 0.000 z 1.000 turn 90.0");
    expect(await at("Fan", 2.5)).toBe("x 0.000 z 1.000 turn 900.0");
    expect(await at("Bob", 1.5)).toBe("x 1.000 z 1.000 turn 0.0");
  }, 240_000);

  it("says a repeat whose round ends elsewhere jumps back, or changes speed at its seam, and carries a motion on at its end speed", async () => {
    const said = await done("blender_animate", {
      keys: [
        { object: "Slider", at: 0, location: [2, 0, 1] },
        { object: "Slider", at: 1, location: [3, 0, 1], easing: "linear" },
        { object: "Cart", at: 0, location: [3, 0, 1] },
        { object: "Cart", at: 1, location: [5, 0, 1], easing: "linear" },
        { object: "Bob", at: 0.5, location: [1, 0, 1], easing: "linear" },
        { object: "Bob", at: 1, location: [1, 0, 0], easing: "linear" },
      ],
      extend: [
        { object: "Slider", mode: "repeat" },
        { object: "Cart", mode: "continue" },
        { object: "Bob", mode: "repeat" },
      ],
    });

    expect(said).toContain(
      "repeats its keys from 0 s to 1 s, a round every 1 s; a round ends 1 m and 0.0° from where it starts, so it jumps back each round.",
    );
    expect(said).toContain(
      "carries on past its keys from 0 s to 1 s at the speeds it ends with: 2 m/s and 0° a second, and comes in at those it starts with.",
    );
    // Straight up and straight down, it turns round at the seam from 2 m/s down to 2 m/s up.
    expect(said).toContain(
      "where a round ends and the next begins its speed changes by 4 m/s and its turning by 0° a second.",
    );
    expect(await at("Cart", 2)).toBe("x 7.000 z 1.000 turn 0.0");
  }, 240_000);

  it("plays a swing back and forth, coming to rest at each end, and holds again when asked", async () => {
    const swung = await done("blender_animate", {
      keys: [
        { object: "Door", at: 0, rotation: [0, 0, 0] },
        { object: "Door", at: 1, rotation: [0, 0, 90] },
      ],
      extend: [{ object: "Door", mode: "back_and_forth" }],
    });
    const back = await at("Door", 1.5);
    const held = await done("blender_animate", {
      extend: [{ object: "Fan", mode: "hold" }],
    });
    const described = await done("blender_describe_scene", {
      objects: ["Door", "Fan", "Bob"],
    });

    expect(swung).toContain(
      "plays its keys from 0 s to 1 s forward and back, on and on, coming to rest at each end.",
    );
    expect(back).toBe("x 4.000 z 1.000 turn 45.0");
    expect(held).toContain(
      "Fan: holds where its keys begin and end, from 0 s to 1 s.",
    );
    expect(await at("Fan", 2.5)).toBe("x 0.000 z 1.000 turn 360.0");
    expect(described).toContain(
      "rotation keyed from 0 s to 1 s, back and forth",
    );
    expect(described).toContain("location keyed from 0 s to 1 s, repeating.");
  }, 240_000);

  it("says whether a timeline keyed as a loop plays round, and refuses to repeat an object with no keys", async () => {
    const looped = await done("blender_animate", {
      clear: ["Bob", "Slider", "Cart", "Door"],
      extend: [{ object: "Fan", mode: "repeat_on" }],
      loop: true,
    });
    const unkeyed = await call("blender_animate", {
      extend: [{ object: "Bob", mode: "repeat" }],
    });

    expect(looped).toContain(
      "As a loop, 1 s, the frame after the timeline's last, runs on into its first, in place and speed.",
    );
    expect(unkeyed.failed).toBe(true);
    expect(unkeyed.said).toContain("Bob has no keys to repeat: key it first.");
  }, 240_000);
});
