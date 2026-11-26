/**
 * Finishes and the marks of use against a real Blender: each finish drawn in
 * its own colour, metal, roughness and coat and rendering in Cycles and in
 * EEVEE; brushed metal brushed along the axis it says; frosted glass letting
 * light through; and wear, grime, rust, scratches, drips, dust and
 * fingerprints each landing where the shape puts it, the answer saying how
 * much of each object each covers and where.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project "system-boundary*" packages/feature/blender-studio
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/sandbox";
import { TemporaryFolders } from "@zhiyin/test-support";
import { withKeptGlCache } from "../test/kept-gl-cache.js";
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

/** Each finish as it is when a call gives none of its values: colour, metal, roughness, coat, and what it shows. */
const finishes: [string, string, number, number, number, string][] = [
  ["brushed-metal", "#c3c5c8", 1, 0.3, 0, "fine brushed lines"],
  [
    "anodised-aluminium",
    "#b6babe",
    1,
    0.38,
    0,
    "a satin anodised skin over fine bead blasting, dyed in its colour",
  ],
  [
    "galvanised-steel",
    "#b8bcbf",
    1,
    0.36,
    0,
    "zinc spangle in crystals about 8 mm across",
  ],
  [
    "car-paint",
    "#1f3a5f",
    0,
    0.4,
    1,
    "metallic flakes 0.15 mm across in a coloured base, under a clear coat",
  ],
  [
    "carbon-fibre",
    "#141518",
    0,
    0.32,
    1,
    "a 2 × 2 twill of 2.5 mm tows under clear resin",
  ],
  [
    "leather",
    "#5a3a26",
    0,
    0.5,
    0,
    "a pebbled grain with creases, and a soft sheen",
  ],
  [
    "fabric",
    "#5f6b7a",
    0,
    0.85,
    0,
    "a plain weave of 0.5 mm threads, with a sheen",
  ],
  [
    "knit",
    "#7d7f86",
    0,
    0.9,
    0,
    "rows of knitted stitches 3 mm wide, soft and fuzzy",
  ],
  [
    "ceramic-glaze",
    "#efece4",
    0,
    0.4,
    1,
    "a glossy glaze over the body, pooling unevenly",
  ],
  [
    "concrete",
    "#8f8c86",
    0,
    0.9,
    0,
    "cast concrete with pores and pale and dark patches",
  ],
  [
    "stone",
    "#8a847b",
    0,
    0.5,
    0,
    "a speckled granite of mineral grains a few millimetres across",
  ],
  ["marble", "#ebe8e2", 0, 0.12, 0, "polished marble with grey veins"],
  ["paper", "#f2f0ea", 0, 0.85, 0, "fine fibres, matt"],
  [
    "cardboard",
    "#b08a5c",
    0,
    0.88,
    0,
    "kraft board with dark fibres and specks",
  ],
  [
    "skin",
    "#c68e6e",
    0,
    0.45,
    0,
    "pores and fine lines, light scattering under it",
  ],
];

// The first picture of materials that read the shape round each point builds
// the graphics card's ray-traced shading in a fresh session, which takes about
// a minute; the tests that render allow for it.
describe.runIf(blender)(
  "finishes and the marks of use in a real Blender",
  { timeout: 600_000 },
  () => {
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
    /** Renders, then reads the picture with Python lines that print what they measure. */
    const measure = async (
      engine: string,
      samples: number,
      lines: string[],
    ) => {
      const rendered = await call("blender_render", {
        output: "renders/finishes.png",
        engine,
        samples,
      });
      expect(rendered.failed, rendered.said).toBe(false);
      const read = await call("blender_run_script", {
        code: [
          "import bpy",
          "image = bpy.data.images.load(bpy.path.abspath('//renders/finishes.png'))",
          "w, h = image.size",
          "p = image.pixels[:]",
          "light = lambda x, y: sum(p[(y * w + x) * 4 + c] for c in range(3)) / 3",
          "red = lambda x, y: p[(y * w + x) * 4] - p[(y * w + x) * 4 + 2]",
          "mean = lambda points, f=light: sum(f(x, y) for x, y in points) / len(points)",
          ...lines,
          "bpy.data.images.remove(image)",
        ].join("\n"),
      });
      expect(read.failed, read.said).toBe(false);
      return read.said;
    };
    const numbers = (said: string, label: string) =>
      (new RegExp(`${label} (.+)`).exec(said)?.[1] ?? "")
        .split(" ")
        .map(Number);

    beforeAll(async () => {
      const root = await folders.make("zhiyin-studio-finishes-");
      const workspace = join(root, "workspace");
      await mkdir(workspace, { recursive: true });
      scenes = new ConversationScenes({
        blender: async () => blender,
        directory: join(root, "data"),
        launch: withKeptGlCache(containedSessionLaunch)(
          { open: openProcessContainer },
          { scripts: join(root, "session-scripts") },
        ),
        script: sessionScript,
      });
      tools = sceneAutomation(scenes.scene("finishes"), {
        workspaceRoot: () => workspace,
        blender: async () => blender,
        directory: scenes.directory("finishes"),
      });
    });

    afterAll(async () => {
      await scenes.forget("finishes");
      await scenes.closeAll();
      await folders.removeAll();
    });

    it("draws each finish in its own colour, metal, roughness and coat, says what it shows, and renders it in Cycles and in EEVEE", async () => {
      await call("blender_open_scene", {
        path: "swatches.blend",
        create: true,
      });
      await call("blender_add_objects", {
        objects: [{ name: "Swatch", kind: "cube", size: [0.06, 0.06, 0.02] }],
      });
      await call("blender_set_lighting", {
        background: { color: "#ffffff", strength: 1 },
      });
      await call("blender_set_camera", {
        frame: { objects: ["Swatch"], direction: "top", margin: 0.1 },
        resolution: [32, 32],
      });
      for (const [
        finish,
        colour,
        metallic,
        roughness,
        coat,
        shows,
      ] of finishes) {
        const made = await call("blender_set_material", {
          objects: ["Swatch"],
          material: { name: finish, finish },
        });

        expect(made.failed, made.said).toBe(false);
        expect(made.said).toContain(`${colour} (${finish}'s own colour)`);
        expect(made.said).toContain(`roughness ${roughness}`);
        expect(made.said.includes("metallic 1")).toBe(metallic === 1);
        expect(made.said.includes("coat 1")).toBe(coat === 1);
        expect(made.said).toContain(`${finish} finish: ${shows}`);
        // A shader Blender cannot build renders magenta; each finish renders in its colours.
        for (const engine of ["eevee", "cycles"]) {
          const said = await measure(engine, 4, [
            "print('magenta', sum(1 for i in range(0, len(p), 4) if p[i] > 0.9 and p[i + 1] < 0.1 and p[i + 2] > 0.9))",
          ]);
          expect(said, `${finish} in ${engine}`).toContain("magenta 0");
        }
      }
    });

    it("says how skin and marble scatter light against the thinnest side of what they are on", async () => {
      await call("blender_open_scene", { path: "scatter.blend", create: true });
      await call("blender_add_objects", {
        objects: [
          { name: "Slab", kind: "cube", size: [0.3, 0.2, 0.02] },
          { name: "Ear", kind: "cube", size: [0.03, 0.006, 0.05] },
        ],
      });

      const slab = await call("blender_set_material", {
        objects: ["Slab"],
        material: { name: "Marble", finish: "marble" },
      });
      const ear = await call("blender_set_material", {
        objects: ["Ear"],
        material: { name: "Skin", finish: "skin" },
      });

      expect(slab.said).toContain(
        "light scattering up to 3 mm under its surface in Cycles, which EEVEE only approximates; Slab's thinnest side is 20 mm",
      );
      expect(ear.said).toContain(
        "light scattering up to 4 mm under its surface in Cycles, which EEVEE only approximates; Ear's thinnest side is 6 mm, so the light shows through it",
      );
    });

    it("brushes metal along an axis of its own, in circles round its turning axis or in lines out from it, and says which", async () => {
      await call("blender_open_scene", { path: "brushed.blend", create: true });
      await call("blender_add_objects", {
        objects: [
          { name: "Bar", kind: "cube", size: [0.3, 0.02, 0.01] },
          {
            name: "Knob",
            kind: "cylinder",
            size: [0.04, 0.04, 0.02],
            location: [0, 0.1, 0],
          },
          {
            name: "Plate",
            kind: "cube",
            size: [0.1, 0.06, 0.005],
            location: [0, -0.1, 0],
          },
        ],
      });

      const bar = await call("blender_set_material", {
        objects: ["Bar"],
        material: { name: "Bar steel", finish: "brushed-metal" },
      });
      const knob = await call("blender_set_material", {
        objects: ["Knob"],
        material: {
          name: "Knob steel",
          finish: "brushed-metal",
          brushing: { pattern: "circular" },
        },
      });
      const plate = await call("blender_set_material", {
        objects: ["Plate"],
        material: {
          name: "Plate steel",
          finish: "brushed-metal",
          brushing: { pattern: "radial" },
        },
      });
      const given = await call("blender_set_material", {
        objects: ["Plate"],
        material: {
          name: "Plate steel",
          finish: "brushed-metal",
          brushing: { pattern: "linear", axis: "y" },
        },
      });
      const notBrushed = await call("blender_set_material", {
        objects: ["Plate"],
        material: {
          name: "Other",
          finish: "rubber",
          brushing: { pattern: "linear" },
        },
      });
      const spiral = await call("blender_set_material", {
        objects: ["Plate"],
        material: {
          name: "Other",
          finish: "brushed-metal",
          brushing: { pattern: "spiral" },
        },
      });

      expect(bar.said).toContain(
        "brushed along its own x axis (Bar's longest side, 300 mm); Cycles draws its highlights out across the lines, EEVEE the lines alone",
      );
      expect(knob.said).toContain(
        "brushed in circles round its own z axis (Knob's turning axis: it is 40 mm across both ways round it)",
      );
      expect(plate.said).toContain(
        "brushed in lines out from its own z axis (Plate's thinnest side, 5 mm)",
      );
      expect(given.said).toContain(
        "brushed along its own y axis; Cycles draws its highlights out across the lines",
      );
      expect(notBrushed.failed).toBe(true);
      expect(notBrushed.said).toContain(
        "brushing says how brushed-metal is brushed: give it with finish brushed-metal.",
      );
      expect(spiral.failed).toBe(true);
      expect(spiral.said).toContain(
        "brushing pattern is linear, circular or radial.",
      );
    });

    it("draws brushed lines along the axis given, seen from above in Cycles and in EEVEE", async () => {
      await call("blender_open_scene", { path: "lines.blend", create: true });
      await call("blender_add_objects", {
        objects: [{ name: "Tile", kind: "cube", size: [0.02, 0.02, 0.004] }],
      });
      await call("blender_set_lighting", {
        background: { color: "#ffffff", strength: 1 },
      });
      await call("blender_set_camera", {
        frame: { objects: ["Tile"], direction: "top", margin: 0 },
        orthographic: true,
        resolution: [240, 240],
        tone: "standard",
      });
      // Over the middle of the tile, how much each row's mean light differs
      // from the next row's, and each column's from the next column's: lines
      // along x make the rows differ and leave the columns alike, and the
      // averaging removes the noise of the picture.
      const changes = async (axis: string, engine: string) => {
        await call("blender_set_material", {
          objects: ["Tile"],
          material: {
            name: "Brushed",
            finish: "brushed-metal",
            brushing: { pattern: "linear", axis },
          },
        });
        const said = await measure(engine, 16, [
          "xs = range(w // 4, w * 3 // 4)",
          "ys = range(h // 4, h * 3 // 4)",
          "rows = [sum(light(x, y) for x in xs) / len(xs) for y in ys]",
          "columns = [sum(light(x, y) for y in ys) / len(ys) for x in xs]",
          "along_x = sum(abs(a - b) for a, b in zip(columns, columns[1:]))",
          "along_y = sum(abs(a - b) for a, b in zip(rows, rows[1:]))",
          "print('changes', round(along_x, 4), round(along_y, 4))",
        ]);
        const [alongX, alongY] = numbers(said, "changes") as [number, number];
        return { alongX, alongY };
      };

      for (const engine of ["cycles", "eevee"]) {
        const x = await changes("x", engine);
        const y = await changes("y", engine);

        // Lines along x change little along x and much across them, in y.
        expect(x.alongY, engine).toBeGreaterThan(x.alongX * 3);
        expect(y.alongX, engine).toBeGreaterThan(y.alongY * 3);
      }
    });

    it("lets light through frosted glass, takes dust and fingerprints on it, and refuses wear on it", async () => {
      await call("blender_open_scene", { path: "frosted.blend", create: true });
      await call("blender_add_objects", {
        objects: [
          { name: "Pane", kind: "cube", size: [0.2, 0.004, 0.2] },
          {
            name: "Lamp",
            kind: "cube",
            size: [0.05, 0.05, 0.05],
            location: [0, 0.1, 0],
          },
        ],
      });
      await call("blender_set_material", {
        objects: ["Lamp"],
        material: {
          name: "Red glow",
          color: "#ff0000",
          emission: { color: "#ff0000", strength: 5 },
        },
      });

      const made = await call("blender_set_material", {
        objects: ["Pane"],
        material: { name: "Frosted", finish: "frosted-glass" },
      });
      const described = await call("blender_describe_scene", {
        objects: ["Pane"],
      });
      const printed = await call("blender_set_material", {
        objects: ["Pane"],
        material: { name: "Frosted", fingerprints: 0.5, dust: 0.3 },
      });
      const worn = await call("blender_set_material", {
        objects: ["Pane"],
        material: { name: "Frosted", wear: 0.5 },
      });
      const clearRubber = await call("blender_set_material", {
        objects: ["Pane"],
        material: { name: "Other", finish: "rubber", transmission: 1 },
      });
      await call("blender_set_camera", {
        frame: { objects: ["Pane"], direction: "front", margin: 0.1 },
        resolution: [64, 64],
        tone: "standard",
      });
      // The middle of the pane, with the glowing red cube behind it.
      const through = await measure("cycles", 32, [
        "middle = [(x, y) for x in range(w * 2 // 5, w * 3 // 5) for y in range(h * 2 // 5, h * 3 // 5)]",
        "print('through', round(mean(middle, red), 4))",
      ]);

      expect(made.failed, made.said).toBe(false);
      expect(made.said).toContain("#f2f5f6 (frosted-glass's own colour)");
      expect(made.said).toContain(
        "frosted-glass finish: etched glass that lets light through, blurred, transmission 1, ior 1.5",
      );
      expect(made.said).toContain("Pane is a thin sheet of glass");
      expect(described.said).toMatch(
        /material Frosted \(#f2f5f6, roughness 0\.4, frosted-glass finish, .*transmission 1, ior 1\.5/,
      );
      expect(printed.failed, printed.said).toBe(false);
      expect(printed.said).toMatch(
        /fingerprints 0\.5 on its open faces, covering/,
      );
      expect(worn.failed).toBe(true);
      expect(worn.said).toContain(
        "finishes, wear and grime are drawn on opaque surfaces, as rust is: frosted-glass is the finish glass takes, and glass and liquids take dust, scratches, drips and fingerprints.",
      );
      expect(clearRubber.failed).toBe(true);
      // The red behind shows through the pane.
      expect(numbers(through, "through")[0]).toBeGreaterThan(0.1);
    });

    it("says how much of each object each mark covers, and whether on edges, in recesses or on open faces", async () => {
      await call("blender_open_scene", { path: "marks.blend", create: true });
      await call("blender_add_objects", {
        objects: [
          { name: "Housing", kind: "cube", size: [0.1, 0.1, 0.05] },
          {
            name: "Lid",
            kind: "cube",
            size: [0.08, 0.06, 0.01],
            location: [0.2, 0, 0],
          },
        ],
      });
      // A pocket 4 cm across and 2 cm deep in the housing's top.
      await call("blender_shape_objects", {
        object: "Housing",
        operations: [
          {
            kind: "boolean",
            operation: "difference",
            cutter: {
              shape: "box",
              size: [0.04, 0.04, 0.04],
              location: [0, 0, 0.025],
            },
          },
        ],
      });
      const shares = (said: string, mark: string, does: string) => {
        const found = new RegExp(
          `${mark} 0\\.8 ${does}, covering about (\\d+)% of Housing \\(([^)]*)\\)`,
        ).exec(said);
        expect(found, said).not.toBeNull();
        const where = found?.[2] ?? "";
        const part = (place: string) =>
          Number(new RegExp(`(\\d+)% ${place}`).exec(where)?.[1] ?? 0);
        return {
          covered: Number(found?.[1]),
          edges: part("on edges"),
          recesses: part("in recesses"),
          open: part("on open faces"),
          down: new RegExp(`running as far as ([\\d.]+) mm down`).exec(where),
        };
      };
      const none = {
        wear: 0,
        grime: 0,
        rust: 0,
        scratches: 0,
        drips: 0,
        dust: 0,
        fingerprints: 0,
      };
      const marked = async (mark: string) =>
        (
          await call("blender_set_material", {
            objects: ["Housing"],
            material: {
              name: "Painted",
              finish: "painted-metal",
              ...none,
              [mark]: 0.8,
            },
          })
        ).said;

      const wear = shares(
        await marked("wear"),
        "wear",
        "on its edges and corners",
      );
      const grime = shares(
        await marked("grime"),
        "grime",
        "in its recesses and corners",
      );
      const rust = shares(
        await marked("rust"),
        "rust",
        "on its edges and in its corners, pitted, and running down from its edges",
      );
      const drips = shares(
        await marked("drips"),
        "drip streaks",
        "running down from its edges",
      );
      const dust = shares(
        await marked("dust"),
        "dust",
        "on its up-facing faces, less under what overhangs them",
      );
      const prints = shares(
        await marked("fingerprints"),
        "fingerprints",
        "on its open faces",
      );
      const scratches = shares(
        await marked("scratches"),
        "scratches",
        "along its own x axis \\(Housing's longest side, 100 mm\\)",
      );
      const both = await call("blender_set_material", {
        objects: ["Housing", "Lid"],
        material: { name: "Dirty", grime: 0.6 },
      });

      // Wear rubs edges; grime gathers in recesses; rust starts on edges and
      // in corners and runs down the walls below them, as drips do.
      expect(wear.edges).toBeGreaterThan(60);
      expect(wear.covered).toBeLessThan(25);
      expect(grime.recesses).toBeGreaterThan(60);
      expect(rust.edges + rust.recesses).toBeGreaterThan(20);
      expect(Number(rust.down?.[1])).toBeGreaterThan(5);
      expect(Number(rust.down?.[1])).toBeLessThanOrEqual(50);
      expect(Number(drips.down?.[1])).toBeGreaterThan(5);
      expect(drips.open).toBeGreaterThan(50);
      // Dust lies on the top and the pocket's floor, the faces that look up:
      // under half of the housing's surface.
      expect(dust.open + dust.recesses).toBeGreaterThan(80);
      expect(dust.covered).toBeGreaterThan(10);
      expect(dust.covered).toBeLessThan(45);
      // Fingerprints and scratches lie on open faces, out of recesses.
      expect(prints.recesses).toBe(0);
      expect(prints.open).toBeGreaterThan(50);
      expect(prints.covered).toBeGreaterThan(0);
      expect(scratches.recesses).toBe(0);
      expect(scratches.open).toBeGreaterThan(50);
      // One call on two objects says where each lands on each.
      expect(both.said).toMatch(
        /grime 0\.6 in its recesses and corners, covering about \d+% of Housing \([^)]*\) and (about \d+%|under 1%|none) of Lid/,
      );
    });

    it("runs rust down from the edges as the object stands, and the runs turn with it afterwards", async () => {
      await call("blender_open_scene", { path: "rust.blend", create: true });
      await call("blender_add_objects", {
        objects: [
          { name: "Post", kind: "cube", size: [0.04, 0.04, 0.2] },
          {
            name: "Upturned",
            kind: "cube",
            size: [0.04, 0.04, 0.2],
            location: [0.1, 0, 0],
            rotation: [180, 0, 0],
          },
        ],
      });
      await call("blender_set_material", {
        objects: ["Post", "Upturned"],
        material: { name: "Steel", color: "#5a6068", rust: 0.6 },
      });
      await call("blender_set_lighting", {
        background: { color: "#ffffff", strength: 1 },
      });
      await call("blender_set_camera", {
        frame: {
          objects: ["Post", "Upturned"],
          direction: "front",
          margin: 0.05,
        },
        orthographic: true,
        resolution: [160, 160],
        tone: "standard",
      });
      // How red each post's front is in its upper and lower thirds, away from its side edges.
      const redness = async (engine: string) => {
        const said = await measure(engine, 16, [
          "from bpy_extras.object_utils import world_to_camera_view",
          "s = bpy.context.scene",
          "for name in ('Post', 'Upturned'):",
          "    o = s.objects[name]",
          "    seen = [world_to_camera_view(s, s.camera, o.matrix_world @ v.co) for v in o.data.vertices]",
          "    x0, x1 = min(v.x for v in seen), max(v.x for v in seen)",
          "    y0, y1 = min(v.y for v in seen), max(v.y for v in seen)",
          "    xs = range(int((x0 + (x1 - x0) * 0.3) * w), int((x0 + (x1 - x0) * 0.7) * w))",
          "    band = lambda a, b: [(x, y) for x in xs for y in range(int((y0 + (y1 - y0) * a) * h), int((y0 + (y1 - y0) * b) * h))]",
          "    print('red', name, round(mean(band(0.7, 0.95), red), 4), round(mean(band(0.05, 0.3), red), 4))",
        ]);
        return {
          post: numbers(said, "red Post") as [number, number],
          upturned: numbers(said, "red Upturned") as [number, number],
        };
      };

      for (const engine of ["cycles", "eevee"]) {
        const { post, upturned } = await redness(engine);
        // Upper third redder than the lower, standing either way up.
        expect(post[0], engine).toBeGreaterThan(post[1] + 0.02);
        expect(upturned[0], engine).toBeGreaterThan(upturned[1] + 0.02);
      }
      // Turned over afterwards, the streaks go with it, as real ones do.
      await call("blender_edit_objects", {
        edits: [{ object: "Post", rotation: [180, 0, 0] }],
      });
      const turned = await redness("cycles");
      expect(turned.post[1]).toBeGreaterThan(turned.post[0] + 0.02);
    });

    it("settles dust on faces that look up and leaves the sides as they were", async () => {
      await call("blender_open_scene", { path: "dust.blend", create: true });
      await call("blender_add_objects", {
        objects: [{ name: "Box", kind: "cube", size: [0.1, 0.1, 0.1] }],
      });
      await call("blender_set_lighting", {
        background: { color: "#ffffff", strength: 1 },
      });
      const look = async (dust: number, direction: string, engine: string) => {
        await call("blender_set_material", {
          objects: ["Box"],
          material: { name: "Dark", color: "#202020", roughness: 0.4, dust },
        });
        await call("blender_set_camera", {
          frame: { objects: ["Box"], direction, margin: 0.1 },
          orthographic: true,
          resolution: [64, 64],
          tone: "standard",
        });
        const said = await measure(engine, 16, [
          "middle = [(x, y) for x in range(w * 2 // 5, w * 3 // 5) for y in range(h * 2 // 5, h * 3 // 5)]",
          "print('face', round(mean(middle), 4))",
        ]);
        return numbers(said, "face")[0] as number;
      };

      for (const engine of ["cycles", "eevee"]) {
        const cleanTop = await look(0, "top", engine);
        const dustyTop = await look(0.8, "top", engine);
        const cleanSide = await look(0, "front", engine);
        const dustySide = await look(0.8, "front", engine);

        expect(dustyTop, engine).toBeGreaterThan(cleanTop * 1.5);
        expect(Math.abs(dustySide - cleanSide), engine).toBeLessThan(
          cleanSide * 0.1,
        );
      }
    });

    it("names the marks a material carries, and how its metal was brushed, when the scene is described", async () => {
      await call("blender_open_scene", { path: "named.blend", create: true });
      await call("blender_add_objects", {
        objects: [{ name: "Knob", kind: "cylinder", size: [0.04, 0.04, 0.02] }],
      });
      await call("blender_set_material", {
        objects: ["Knob"],
        material: {
          name: "Knob steel",
          finish: "brushed-metal",
          brushing: { pattern: "circular" },
          rust: 0.3,
          dust: 0.2,
          fingerprints: 0.4,
        },
      });

      const described = await call("blender_describe_scene", {
        objects: ["Knob"],
      });

      expect(described.said).toContain("brushed-metal finish");
      expect(described.said).toContain(
        "brushed in circles round its own z axis",
      );
      expect(described.said).toContain("rust 0.3");
      expect(described.said).toContain("dust 0.2");
      expect(described.said).toContain("fingerprints 0.4");
    });

    it("keeps the marks across calls, says each change, and lays rust's runs on each shape it is given to", async () => {
      await call("blender_add_objects", {
        objects: [
          {
            name: "Later",
            kind: "cube",
            size: [0.04, 0.04, 0.1],
            location: [0.2, 0, 0],
          },
          {
            name: "Pane",
            kind: "cube",
            size: [0.1, 0.01, 0.1],
            location: [0.4, 0, 0],
          },
        ],
      });

      const more = await call("blender_set_material", {
        objects: ["Knob"],
        material: { name: "Knob steel", rust: 0.5 },
      });
      const reused = await call("blender_set_material", {
        objects: ["Later"],
        material: { name: "Knob steel" },
      });
      const runs = await call("blender_run_script", {
        code: "import bpy\nprint('runs', 'zhiyin_runs' in bpy.data.objects['Later'].data.attributes)",
      });
      const refinished = await call("blender_set_material", {
        objects: ["Knob"],
        material: { name: "Knob steel", finish: "anodised-aluminium" },
      });
      await call("blender_set_material", {
        objects: ["Pane"],
        material: { name: "Frost", finish: "frosted-glass" },
      });
      const clearer = await call("blender_set_material", {
        objects: ["Pane"],
        material: { name: "Frost", transmission: 1 },
      });

      expect(more.said).toContain("Knob steel changed: rust 0.3 to 0.5.");
      expect(reused.failed, reused.said).toBe(false);
      expect(runs.said).toContain("runs True");
      // A brushing belongs to brushed metal, so another finish leaves it behind.
      expect(refinished.failed, refinished.said).toBe(false);
      expect(refinished.said).toContain(
        "finish brushed-metal to anodised-aluminium",
      );
      expect(refinished.said).toContain("brushing circular to none");
      // Frosted glass lets light through, so it stays with a transmission given.
      expect(clearer.failed, clearer.said).toBe(false);
      expect(clearer.said).toContain("frosted-glass finish");
    });

    it("refuses an amount of a mark outside 0 to 1", async () => {
      const opened = await call("blender_open_scene", {
        path: "refused.blend",
        create: true,
      });
      expect(opened.failed, opened.said).toBe(false);
      await call("blender_add_objects", {
        objects: [{ name: "Box", kind: "cube", size: [0.1, 0.1, 0.1] }],
      });

      const refused = await call("blender_set_material", {
        objects: ["Box"],
        material: { name: "Rusty", rust: 1.5 },
      });

      expect(refused.failed).toBe(true);
      expect(refused.said).toContain("rust must be at most 1.");
    });
  },
);
