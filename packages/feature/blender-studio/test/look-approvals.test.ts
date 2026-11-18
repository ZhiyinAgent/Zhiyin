/**
 * How a call that shapes a picture's light and look reads for approval:
 * which objects a light lights and lets cast its shadows, cards, the rays
 * that see objects, fog, caustics, outlines, a render's post and EEVEE's
 * options, Cycles's sampling, toon shading and what a motion does past its
 * keys, each in plain rows.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  prepareAnimate,
  prepareCamera,
  prepareLighting,
  prepareMaterial,
} from "../src/change-calls.js";
import { prepareRender } from "../src/output-calls.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

async function place() {
  const root = await folders.make("zhiyin-look-approvals-");
  await mkdir(join(root, "renders"), { recursive: true });
  return { root, scene: "scene.blend", protect: [] };
}

/** The rows a person reads for a call, or the refusal it meets. */
async function rows(
  prepare: typeof prepareLighting,
  args: Record<string, unknown>,
) {
  const prepared = await prepare(args, await place());
  if ("reason" in prepared) return prepared.reason;
  return prepared.rows.map(({ name, value }) => ({ name, value }));
}

describe("approving how a scene is lit", () => {
  it("says which objects a light lights and which cast its shadows", async () => {
    expect(
      await rows(prepareLighting, {
        lights: [
          {
            name: "Key",
            kind: "spot",
            power: 500,
            lights_only: ["Mug", "Saucer"],
            shadows_except: ["Table"],
          },
          { name: "Fill", lights_only: [] },
        ],
      }),
    ).toEqual([
      {
        name: "Key",
        value: "spot, 500 W, lights only Mug, Saucer, no shadows from Table",
      },
      { name: "Fill", value: "area, lights everything" },
    ]);
  });

  it("says each card's kind, the rays that see objects, fog and caustics", async () => {
    expect(
      await rows(prepareLighting, {
        cards: [
          { name: "Strip", kind: "reflection", strength: 6 },
          { name: "Bounce", kind: "bounce", color: "#fff4e0" },
        ],
        seen_by: [{ objects: ["Wall"], camera: false, shadows: true }],
        fog: { density: 0.05, anisotropy: 0.4 },
        caustics: {
          refractive: true,
          casters: ["Glass"],
          receivers: ["Table"],
        },
      }),
    ).toEqual([
      {
        name: "Card Strip",
        value: "a glowing card seen only in reflections, strength 6",
      },
      {
        name: "Card Bounce",
        value: "a white card that only bounces light, #fff4e0",
      },
      { name: "Seen by: Wall", value: "seen by shadows; not by the camera" },
      {
        name: "Fog",
        value: "density 0.05 a metre, anisotropy 0.4, in a box round the scene",
      },
      {
        name: "Caustics",
        value: "refractive on, cast by Glass, onto Table",
      },
    ]);
    expect(await rows(prepareLighting, { fog: { density: 0 } })).toEqual([
      { name: "Fog", value: "removed" },
    ]);
  });

  it("says a light's shape, size, colour temperature, exposure and a sun's width", async () => {
    expect(
      await rows(prepareLighting, {
        lights: [
          {
            name: "Strip",
            kind: "area",
            shape: "rectangle",
            size: [0.1, 2],
            kelvin: 3200,
            exposure: 1,
          },
          { name: "Sun", kind: "sun", strength: 3, angle: 0.53, kelvin: 0 },
        ],
      }),
    ).toEqual([
      {
        name: "Strip",
        value: "area, 3200 K, exposure 1, rectangle, 0.1 × 2 m",
      },
      {
        name: "Sun",
        value: "sun, strength 3, no colour temperature, 0.53° across the sky",
      },
    ]);
  });

  it("says a card's own rays, fog that thins with height and path guiding", async () => {
    expect(
      await rows(prepareLighting, {
        cards: [
          {
            name: "Panel",
            kind: "reflection",
            seen_by: { camera: true, refraction: false },
          },
        ],
        fog: { density: 0.5, height_falloff: 0.3 },
        caustics: { path_guiding: true },
      }),
    ).toEqual([
      {
        name: "Card Panel",
        value:
          "a glowing card seen only in reflections, seen by the camera; not by refraction",
      },
      {
        name: "Fog",
        value:
          "density 0.5 a metre, halving every 0.3 m up, in a box round the scene",
      },
      { name: "Caustics", value: "path guiding on" },
    ]);
  });
});

describe("approving how a picture is drawn", () => {
  it("says the outlines' method, width and colour", async () => {
    expect(
      await rows(prepareCamera, {
        outlines: { method: "freestyle", thickness: 3 },
      }),
    ).toEqual([{ name: "Outlines", value: "Freestyle lines, 3 px, #000000" }]);
    expect(await rows(prepareCamera, { outlines: { method: "none" } })).toEqual(
      [{ name: "Outlines", value: "removed" }],
    );
  });

  it("says a render's post in order, and EEVEE's options", async () => {
    const said = await rows(prepareRender, {
      output: "renders/hero.png",
      engine: "eevee",
      post: [
        { step: "bloom" },
        { step: "vignette" },
        { step: "film_grain", amount: 0.5 },
      ],
      eevee: {
        final: true,
        shadows: { rays: 2 },
        raytracing: { method: "off" },
        probes: true,
      },
    });
    expect(said).toContainEqual({
      name: "Post",
      value: "Bloom, Vignette, Film Grain at 50%",
    });
    expect(said).toContainEqual({
      name: "EEVEE",
      value:
        "the picture to hand over, 2 shadow rays, no ray tracing, light probes baked",
    });
    expect(
      await rows(prepareRender, { output: "renders/hero.png", post: [] }),
    ).toContainEqual({ name: "Post", value: "none" });
  });

  it("says the sampling a Cycles render keeps, with its denoiser and clamps", async () => {
    const said = await rows(prepareRender, {
      output: "renders/hero.png",
      samples: 512,
      sampling: {
        noise_threshold: 0.05,
        time_limit: 30,
        seed: 7,
        denoise: "best",
        clamp: { direct: 0, indirect: 4 },
      },
    });
    expect(said).toContainEqual({
      name: "Sampling",
      value:
        "stopping at noise 0.05, at most 30 s, seed 7, denoised best, direct light unclamped, indirect light clamped at 4",
    });
  });

  it("says a material's toon bands, shadows and rim", async () => {
    const said = await rows(prepareMaterial, {
      objects: ["Box"],
      material: { name: "Paint" },
      toon: { bands: 2, shadow_color: "#404080", rim: {} },
    });
    expect(said).toContainEqual({
      name: "Toon",
      value: "2 bands, shadows #404080, a #ffffff rim",
    });
  });
});

describe("approving what a motion does past its keys", () => {
  it("names each object's mode, and is a call that sets something on its own", async () => {
    expect(
      await rows(prepareAnimate, {
        extend: [
          { object: "Fan", mode: "repeat_on" },
          { object: "Door", mode: "back_and_forth" },
        ],
      }),
    ).toEqual([
      {
        name: "Fan past its keys",
        value: "repeats its keys, each round on from the last",
      },
      { name: "Door past its keys", value: "plays its keys back and forth" },
    ]);
  });
});
