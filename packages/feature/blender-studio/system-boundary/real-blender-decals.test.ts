/**
 * Decals against a real Blender: a picture projected onto a face and partly
 * off its edge, onto a slanted face where it stretches, text on a card of its
 * own over another decal, a flat card on a round can, a decal so near the
 * surface the camera's distance makes EEVEE mix the two, and strips run
 * along sharp edges, round a height, round a CAD surface group, along seams
 * and along a curve. Each answer measures where the decal landed and how it
 * lies on the surface, and the pictures show it.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-decals.test.ts
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

/** A 200 × 100 px picture, red inside a transparent border a tenth of its width. */
const LOGO = `
import bpy, numpy
img = bpy.data.images.new("logo", 200, 100, alpha=True)
px = numpy.zeros((100, 200, 4), dtype=numpy.float32)
px[10:90, 20:180] = (1, 0, 0, 1)
img.pixels.foreach_set(px.ravel())
img.filepath_raw = "logo.png"
img.file_format = "PNG"
img.save()
bpy.data.images.remove(img)
`;

/** A camera 3 m in front of the crate's label, looking at it. */
const CAMERA = `
import bpy, math
cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
bpy.context.scene.collection.objects.link(cam)
cam.location = (0.4, -3.5, 0.5)
cam.rotation_euler = (math.radians(90), 0, 0)
bpy.context.scene.camera = cam
`;

/** Renders the camera's picture small and says whether its middle and a place left of it are red or blue. */
const SEEN = (engine: string) => `
import bpy
s = bpy.context.scene
s.render.engine = "${engine}"
s.render.resolution_x = s.render.resolution_y = 48
s.render.resolution_percentage = 100
if s.render.engine == "CYCLES":
    s.cycles.samples = 8
    s.cycles.device = "CPU"
else:
    s.eevee.taa_render_samples = 4
s.render.filepath = bpy.path.abspath("//seen.png")
bpy.ops.render.render(write_still=True)
img = bpy.data.images.load(s.render.filepath, check_existing=False)
px = img.pixels[:]
def colour(x, y):
    r, g, b = px[(y * 48 + x) * 4 : (y * 48 + x) * 4 + 3]
    return "red" if r > 2 * b else "blue" if b > 2 * r else f"{r:.2f} {g:.2f} {b:.2f}"
print("middle", colour(24, 24), "left", colour(14, 24))
bpy.data.images.remove(img)
`;

describe.runIf(blender)("decals in a real Blender", () => {
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
  const script = async (code: string) => {
    const ran = await call("blender_run_script", { code });
    expect(ran.failed, ran.said).toBe(false);
    return ran.said;
  };
  /** The numbers of a "from a to b mm" range in an answer. */
  const range = (said: string, before: string) => {
    const found = new RegExp(`${before} (-?[\\d.]+) to (-?[\\d.]+) mm`).exec(
      said,
    );
    expect(found, said).not.toBeNull();
    return [Number(found![1]), Number(found![2])];
  };

  beforeAll(async () => {
    const root = await folders.make("zhiyin-studio-decals-");
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
    tools = sceneAutomation(scenes.scene("decals"), {
      workspaceRoot: () => workspace,
      blender: async () => blender,
      directory: scenes.directory("decals"),
    });
    await call("blender_open_scene", { path: "decals.blend", create: true });
    await script(LOGO);
    const added = await call("blender_add_objects", {
      objects: [
        { name: "Crate", kind: "cube", size: [1, 1, 1], location: [0, 0, 0.5] },
        {
          name: "Turned",
          kind: "cube",
          size: [1, 1, 1],
          location: [3, 0, 0.5],
          rotation: [0, 0, 45],
        },
      ],
    });
    expect(added.failed, added.said).toBe(false);
    await call("blender_set_material", {
      objects: ["Crate"],
      material: { name: "Wood", color: "#3366cc", roughness: 0.6 },
    });
    await script(CAMERA);
  });

  afterAll(async () => {
    await scenes.forget("decals");
    await scenes.closeAll();
    await folders.removeAll();
  });

  it("projects a picture onto a face, says the part off its edge, and shows it in both engines", async () => {
    const label = await call("blender_add_decal", {
      object: "Crate",
      name: "Label",
      picture: "logo.png",
      at: [0.4, -0.5, 0.5],
      direction: [0, 1, 0],
      size: 0.4,
    });
    const kept = await script(`
import bpy
d = bpy.data.objects["Label"]
m = d.material_slots[0].material
p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
print(d.parent.name, m.name, round(p.inputs["Roughness"].default_value, 3), [uv.name for uv in d.data.uv_layers] == [uv.name for uv in d.parent.data.uv_layers] + ["Decal"])
`);
    const cycles = await script(SEEN("CYCLES"));
    const eevee = await script(SEEN("BLENDER_EEVEE"));
    const described = await call("blender_describe_scene", {
      objects: ["Crate"],
    });

    expect(label.failed, label.said).toBe(false);
    // A decal is held by what it lies on, never a loose piece of it.
    expect(described.said).toContain("Crate");
    expect(described.said).not.toContain("touch no other shape");
    expect(label.said).toContain(
      "Decal “Label” on Crate: logo.png (200 × 100 px), 400 × 200 mm, projected along (0, 1, 0) onto the surface at (400, -500, 500 mm), which faces (0, -1, 0) there.",
    );
    expect(label.said).toContain(
      "On the surface it spans 300 × 200 mm along its middle lines and covers 600 cm²; worst stretch 1× (none).",
    );
    expect(label.said).toContain(
      "25% of it is off an edge, over no surface of Crate; none is on the back side.",
    );
    expect(label.said).toContain(
      "It changes the colour of Crate's material “Wood” in a copy of its own, “Label on Wood”, which keeps Wood's other values.",
    );
    expect(label.said).toContain("It overlaps no other decal.");
    expect(label.said).toContain(
      "It stands 0.1 mm off the surface and moves with Crate. At the camera's 3 m, EEVEE parts surfaces 0.009 mm apart and Cycles 0.0003 mm: neither mixes them up.",
    );
    // The decal keeps the crate's own layouts by name, and adds its own.
    expect(kept).toContain("Crate Label on Wood 0.6 True");
    expect(cycles).toContain("middle red left blue");
    expect(eevee).toContain("middle red left blue");
  });

  it("names the stretch where a slanted face takes the picture at an angle", async () => {
    const slanted = await call("blender_add_decal", {
      object: "Turned",
      name: "Slanted",
      picture: "logo.png",
      at: [3.2, 0, 0.5],
      direction: [0, 1, 0],
      size: 0.2,
    });

    expect(slanted.failed, slanted.said).toBe(false);
    expect(slanted.said).toContain(
      "projected along (0, 1, 0) onto the surface at (3.2, -0.5071, 0.5 m), which faces (0.707, -0.707, 0) there.",
    );
    expect(slanted.said).toContain(
      "On the surface it spans 282.8 × 100 mm along its middle lines and covers 282.8 cm²; worst stretch 1.41×",
    );
    expect(slanted.said).toContain(
      "Turned has no material, so its copy starts from Blender's plain grey.",
    );
  });

  it("lays text on a card of its own over another decal, above it, changing only the surface's roughness and relief", async () => {
    const badge = await call("blender_add_decal", {
      object: "Crate",
      name: "Badge",
      kind: "mesh",
      text: "OK",
      color: "#ffffff",
      at: [0.35, -0.5, 0.5],
      size: 0.08,
      affects: ["roughness", "normal"],
      roughness: 0.1,
      relief: 0.0005,
    });
    const kept = await script(`
import bpy
m = bpy.data.objects["Badge"].material_slots[0].material
bump = next(n for n in m.node_tree.nodes if n.type == "BUMP")
p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
print("bump", round(bump.inputs["Distance"].default_value, 6), "colour linked", p.inputs["Base Color"].is_linked)
`);

    expect(badge.failed, badge.said).toBe(false);
    expect(badge.said).toMatch(
      /^Decal “Badge” on Crate: text “OK” drawn as a 1024 × \d+ px picture, 80 × \d+(\.\d+)? mm, a card of its own at \(350, -500, 500 mm\), facing \(0, -1, 0\), bent to the surface\./m,
    );
    expect(badge.said).toContain("Gap to the surface: 0.2 to 0.2 mm.");
    expect(badge.said).toContain(
      "It changes the roughness (0.1) and relief (0.5 mm raised) of Crate's material “Wood” in a copy of its own, “Badge on Wood”, which keeps Wood's other values.",
    );
    expect(badge.said).toContain(
      "It overlaps “Label” over 100% of its area and sits above it.",
    );
    expect(badge.said).toContain("It stands 0.2 mm off the surface");
    expect(kept).toContain("bump 0.0005 colour linked False");
  });

  it("says how far a flat card stands off a round can, and how near a bent one follows it", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Can",
          kind: "cylinder",
          size: [0.2, 0.2, 0.4],
          location: [-3, 0, 0.2],
          segments: 63,
        },
      ],
    });
    const flat = await call("blender_add_decal", {
      object: "Can",
      name: "Flat card",
      kind: "mesh",
      conform: false,
      picture: "logo.png",
      at: [-3, -0.2, 0.25],
      size: 0.1,
    });
    const bent = await call("blender_add_decal", {
      object: "Can",
      name: "Bent card",
      kind: "mesh",
      picture: "logo.png",
      at: [-3, -0.2, 0.12],
      size: 0.1,
    });

    expect(flat.failed, flat.said).toBe(false);
    expect(flat.said).toContain(", flat.");
    const [flatLeast, flatMost] = range(flat.said, "Gap to the surface:");
    expect(flatLeast).toBeGreaterThanOrEqual(0.09);
    expect(flatLeast).toBeLessThanOrEqual(0.25);
    // The card's corners stand 50 mm to the side of where it touches a can
    // 100 mm round: sqrt(50² + 100²) - 100 = 11.8 mm off its nearest side.
    expect(flatMost).toBeGreaterThan(11.6);
    expect(flatMost).toBeLessThan(12.1);
    expect(bent.failed, bent.said).toBe(false);
    const [bentLeast, bentMost] = range(bent.said, "Gap to the surface:");
    // A 3.1 mm cell across a ridge between two of the can's 63 sides, which
    // part by 5.7°, sags up to 1.56 mm × tan 5.7° / 2 = 0.078 mm below it.
    expect(bentLeast).toBeGreaterThan(0.1 - 0.078);
    expect(bentMost).toBeLessThan(0.15);
    expect(bent.said).toContain(
      "None is off an edge; none is on the back side.",
    );
  });

  it("warns of z-fighting when a decal stands nearer the surface than EEVEE parts at the camera's distance", async () => {
    const near = await call("blender_add_decal", {
      object: "Crate",
      name: "Thin",
      picture: "logo.png",
      at: [0, 0, 1.2],
      size: 0.2,
      offset: 0.000005,
    });

    expect(near.failed, near.said).toBe(false);
    expect(near.said).toContain(
      "onto the surface at (0, 0, 1 m), which faces (0, 0, 1) there.",
    );
    expect(near.said).toContain(
      "It stands 0.005 mm off the surface and moves with Crate. At the camera's 3.558 m, EEVEE parts surfaces 0.011 mm apart: the surface may show through it in patches (z-fighting) there; give an offset of at least 0.011 mm, or render with Cycles, which parts them from 0.00036 mm.",
    );
  });

  it("replaces a decal of the same name, turned as asked, and refuses one that lands on nothing or takes another object's name", async () => {
    const again = await call("blender_add_decal", {
      object: "Crate",
      name: "Thin",
      picture: "logo.png",
      at: [0, 0, 1.2],
      size: 0.1,
      rotation: 90,
    });
    const names = await script(
      "import bpy\nprint(sorted(o.name for o in bpy.data.objects if o.name.startswith('Thin')), [round(c, 4) for c in bpy.data.objects['Thin'].dimensions])",
    );
    const nowhere = await call("blender_add_decal", {
      object: "Crate",
      picture: "logo.png",
      at: [5, 0, 0.5],
      direction: [0, 1, 0],
      size: 0.1,
    });
    const taken = await call("blender_add_decal", {
      object: "Crate",
      name: "Turned",
      picture: "logo.png",
      at: [0, 0, 1.2],
      size: 0.1,
    });

    expect(again.said).toContain("It replaces the earlier decal “Thin”.");
    // On a face looking up, its width runs along +x; turned a quarter
    // counter-clockwise, along +y: 50 × 100 mm, flat on the face.
    expect(names).toContain("['Thin'] [0.05, 0.1, 0.0]");
    expect(nowhere.failed).toBe(true);
    expect(nowhere.said).toContain(
      "Cast along (0, 1, 0) through (5, 0, 0.5 m), the decal meets no surface of Crate, which spans (-0.5, -0.5, 0 m) to (0.5, 0.5, 1 m).",
    );
    expect(taken.failed).toBe(true);
    expect(taken.said).toContain(
      "“Turned” is an object of the scene, not a decal: give the decal another name.",
    );
  });

  it("runs dashes along a box's sharp edges, folded over each, and says the corners", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Case",
          kind: "cube",
          size: [0.4, 0.3, 0.2],
          location: [0, 3, 0.1],
        },
      ],
    });
    const trim = await call("blender_add_decal", {
      object: "Case",
      name: "Case trim",
      kind: "strip",
      along: { sharp_angle: 30 },
      width: 0.01,
      pattern: "dash",
      pitch: 0.05,
      color: "#202020",
    });
    const folded = await script(`
import bpy
o = bpy.data.objects["Case trim"]
d = o.dimensions
print("trim", round(d.x, 4), round(d.y, 4), round(d.z, 4))
`);

    expect(trim.failed, trim.said).toBe(false);
    expect(trim.said).toContain(
      "Strip “Case trim” on Case along its edges sharper than 30°: 12 runs, 3.6 m long.",
    );
    expect(trim.said).toContain(
      "72 dashes, one every 50 mm (asked 50 mm), 10 mm wide, printed flat.",
    );
    expect(trim.said).toContain(
      "8 corners where runs meet: across them the widest gap between dashes is 20 mm, as between them along a run.",
    );
    expect(trim.said).toContain(
      "It stands 0.1 mm off the surface and moves with Case.",
    );
    expect(trim.said).toContain(
      "Its own material “Case trim material”: colour #202020, roughness 0.5, metal 0, coat 0.",
    );
    // Folded over the edges, the strip reaches 5 mm onto each face beside
    // them, and stands 0.1 mm off the box: 400.2 × 300.2 × 200.2 mm.
    expect(folded).toContain("trim 0.4002 0.3002 0.2002");
  });

  it("stitches round a can at a height, raised, in one closed loop evened out to fit", async () => {
    const stitches = await call("blender_add_decal", {
      object: "Can",
      name: "Stitches",
      kind: "strip",
      along: { height: 0.3 },
      width: 0.002,
      pattern: "stitch",
      pitch: 0.008,
      raised: 0.001,
    });
    // The can's 63 sides make a loop 63 × 0.2 × sin(π/63) m round.
    const loop = 63 * 0.2 * Math.sin(Math.PI / 63);
    const count = Math.round(loop / 0.008);

    expect(stitches.failed, stitches.said).toBe(false);
    expect(stitches.said).toContain(
      `Strip “Stitches” on Can round it at a height of 300 mm: 1 run, ${Number((loop * 1000).toPrecision(4))} mm long.`,
    );
    expect(stitches.said).toContain(
      `${count} stitches, one every ${Number(((loop / count) * 1000).toPrecision(4))} mm (asked 8 mm), 2 mm wide, raised 1 mm.`,
    );
    expect(stitches.said).toContain(
      "It runs round a closed loop, with no corners.",
    );
  });

  it("runs a band round a CAD part's surface group, along seams and along a curve laid on the surface", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Part",
          kind: "cube",
          size: [0.2, 0.2, 0.2],
          location: [0, -3, 0.1],
        },
      ],
    });
    await script(`
import bpy
o = bpy.data.objects["Part"]
for name in ("Body", "Machined"):
    o.data.materials.append(bpy.data.materials.new(name))
for f in o.data.polygons:
    f.material_index = 1 if f.normal.z > 0.9 else 0
o.data["zhiyin_surfaces"] = ["", "machined"]
for e in o.data.edges:
    a, b = (o.data.vertices[i].co for i in e.vertices)
    e.use_seam = abs(a.z - b.z) > 0.1
c = bpy.data.curves.new("Path", "CURVE")
c.dimensions = "3D"
line = c.splines.new("POLY")
line.points.add(1)
line.points[0].co = (-0.4, -0.2, 1.05, 1)
line.points[1].co = (0.4, -0.2, 1.05, 1)
bpy.context.scene.collection.objects.link(bpy.data.objects.new("Path", c))
`);
    const band = await call("blender_add_decal", {
      object: "Part",
      name: "Band",
      kind: "strip",
      along: { surface_group: "machined" },
      width: 0.005,
      pattern: "solid",
    });
    const seams = await call("blender_add_decal", {
      object: "Part",
      name: "Seam dashes",
      kind: "strip",
      along: { seams: true },
      width: 0.004,
    });
    const arrows = await call("blender_add_decal", {
      object: "Crate",
      name: "Arrows",
      kind: "strip",
      along: { curve: "Path" },
      width: 0.04,
      pattern: "chevron",
    });
    const repeated = await call("blender_add_decal", {
      object: "Part",
      name: "Logos",
      kind: "strip",
      along: { height: 0.1 },
      width: 0.01,
      pattern: "picture",
      picture: "logo.png",
    });
    const both = await call("blender_add_decal", {
      object: "Part",
      kind: "strip",
      along: { seams: true, height: 0.1 },
      width: 0.004,
    });

    expect(band.failed, band.said).toBe(false);
    expect(band.said).toContain(
      "Strip “Band” on Part round its “machined” surfaces: 1 run, 800 mm long.",
    );
    expect(band.said).toContain("A plain band 5 mm wide, printed flat.");
    expect(band.said).toContain(
      "It runs round a closed loop, with no corners.",
    );
    expect(seams.failed, seams.said).toBe(false);
    expect(seams.said).toContain(
      "Strip “Seam dashes” on Part along its seams: 4 runs, 800 mm long.",
    );
    expect(seams.said).toContain("No corners: no runs meet.");
    expect(arrows.failed, arrows.said).toBe(false);
    expect(arrows.said).toContain(
      "Strip “Arrows” on Crate along the curve “Path”: 1 run, 800 mm long.",
    );
    expect(arrows.said).toContain(
      "20 chevrons, one every 40 mm (by default 1 width), 40 mm wide, printed flat.",
    );
    // Round the 0.2 m part at mid-height, a 10 mm strip repeats the 2:1 logo
    // every 20 mm: 40 times in its 800 mm.
    expect(repeated.failed, repeated.said).toBe(false);
    expect(repeated.said).toContain(
      "40 repeats of logo.png, one every 20 mm (by default the picture's proportions), 10 mm wide, printed flat.",
    );
    expect(both.failed).toBe(true);
    expect(both.said).toContain(
      "along takes exactly one of sharp_angle, surface_group, seams, curve and height.",
    );
  });

  it("draws a rivet by shading alone over a brushed finish's own relief, the plate unchanged round it, and rivets along an edge", async () => {
    await call("blender_add_objects", {
      objects: [
        {
          name: "Plate",
          kind: "cube",
          size: [0.2, 0.2, 0.02],
          location: [3, -3, 0.01],
        },
      ],
    });
    const finished = await call("blender_set_material", {
      objects: ["Plate"],
      material: { name: "Steel", finish: "brushed-metal" },
    });
    expect(finished.failed, finished.said).toBe(false);
    const rivet = await call("blender_add_decal", {
      object: "Plate",
      name: "Rivet",
      kind: "normal",
      shape: "rivet",
      at: [3, -3, 0.05],
      size: 0.01,
    });
    const kept = await script(`
import bpy
m = bpy.data.objects["Rivet"].material_slots[0].material
p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bump = p.inputs["Normal"].links[0].from_node
was = bpy.data.materials["Steel"].node_tree.nodes
under = next(n for n in was if n.type == "BSDF_PRINCIPLED").inputs["Normal"].links[0].from_node
print("bump", bump.type, round(bump.inputs["Distance"].default_value, 5), "over", bump.inputs["Normal"].links[0].from_node.name == under.name)
`);
    // Seen from above under a low sun, in EEVEE, which draws the same
    // picture each time: with the decal and without, the plate differs only
    // where the rivet is.
    const seen = await script(`
import bpy, math, numpy
s = bpy.context.scene
was = s.camera
cam = bpy.data.objects.new("Above", bpy.data.cameras.new("Above"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = 0.03
cam.location = (3, -3, 0.3)
s.collection.objects.link(cam)
sun = bpy.data.objects.new("Low sun", bpy.data.lights.new("Low sun", "SUN"))
sun.rotation_euler = (math.radians(70), 0, math.radians(30))
sun.data.energy = 5
s.collection.objects.link(sun)
s.camera = cam
s.render.engine = "BLENDER_EEVEE"
s.eevee.taa_render_samples = 4
s.render.resolution_x = s.render.resolution_y = 48
s.render.resolution_percentage = 100
s.render.filepath = bpy.path.abspath("//above.png")
def shot():
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(s.render.filepath, check_existing=False)
    px = numpy.array(img.pixels[:]).reshape(48, 48, 4)[:, :, :3]
    bpy.data.images.remove(img)
    return px
d = bpy.data.objects["Rivet"]
a = shot()
d.hide_render = True
b = shot()
d.hide_render = False
diff = numpy.abs(a - b).sum(axis=2)
# The decal's corners, 6.6 mm from its middle and inside its 10 mm square, are past the rivet's 4.6 mm head.
corners = max(float(diff[y, x]) for x in (16, 31) for y in (16, 31))
print("rivet", round(float(diff[18:30, 18:30].max()), 3), "corners", round(corners, 3))
s.camera = was
bpy.data.objects.remove(cam)
bpy.data.objects.remove(sun)
`);
    const row = await call("blender_add_decal", {
      object: "Plate",
      name: "Rivet row",
      kind: "strip",
      along: { height: 0.015 },
      width: 0.004,
      pattern: "shape",
      shape: "rivet",
    });

    expect(rivet.failed, rivet.said).toBe(false);
    expect(rivet.said).toContain(
      "Decal “Rivet” on Plate: a rivet head drawn as a 512 × 512 px height map, 10 × 10 mm, projected along (0, 0, -1) onto the surface at (3, -3, 0.02 m), which faces (0, 0, 1) there.",
    );
    expect(rivet.said).toMatch(
      /It changes only the relief of Plate's material “Steel”, standing 2\.2 mm, its recesses darkened by up to \d+%, in a copy of its own, “Rivet on Steel”, which keeps Steel's other values\. The surface's own relief \(Bump\) still shows under it\./,
    );
    expect(rivet.said).toContain(
      "It is drawn by shading alone: the outline stays the surface's",
    );
    expect(kept).toContain("bump BUMP 0.0022 over True");
    const [, shown, corners] = /rivet ([\d.]+) corners ([\d.]+)/.exec(seen)!;
    expect(Number(shown), seen).toBeGreaterThan(0.05);
    // EEVEE draws the plate through a decal 0.1 mm above it to within 1% a channel.
    expect(Number(corners), seen).toBeLessThan(0.03);
    // Round the plate's 0.8 m sides, a 4 mm rivet every 3 of its lengths:
    // 800 / 12 = 66.7, evened out to 67.
    expect(row.failed, row.said).toBe(false);
    expect(row.said).toContain(
      "Strip “Rivet row” on Plate round it at a height of 15 mm: 1 run, 800 mm long.",
    );
    expect(row.said).toContain(
      "A rivet head repeated 67 times, one every 11.94 mm (by default 3 of its lengths), 4 mm wide, drawn by shading alone.",
    );
  });

  it("presses a groove along a curve, says its open ends and where the curve leaves the surface, and where a loop meets the outline", async () => {
    await script(`
import bpy
def line(name, a, b):
    c = bpy.data.curves.new(name, "CURVE")
    c.dimensions = "3D"
    s = c.splines.new("POLY")
    s.points.add(1)
    s.points[0].co = (*a, 1)
    s.points[1].co = (*b, 1)
    bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, c))
line("Across", (-0.2, 3, 0.2), (0.2, 3, 0.2))
line("Short", (-0.1, 3.05, 0.21), (0.1, 3.05, 0.21))
`);
    const across = await call("blender_add_decal", {
      object: "Case",
      name: "Lid line",
      kind: "strip",
      along: { curve: "Across" },
      width: 0.002,
      pattern: "groove",
    });
    const short = await call("blender_add_decal", {
      object: "Case",
      name: "Short line",
      kind: "strip",
      along: { curve: "Short" },
      width: 0.002,
      pattern: "groove",
      relief: -0.0005,
    });
    const loop = await call("blender_add_decal", {
      object: "Case",
      name: "Waist",
      kind: "strip",
      along: { height: 0.1 },
      width: 0.002,
      pattern: "groove",
    });
    const coloured = await call("blender_add_decal", {
      object: "Case",
      kind: "strip",
      along: { height: 0.05 },
      width: 0.002,
      pattern: "groove",
      color: "#ff0000",
    });

    expect(across.failed, across.said).toBe(false);
    expect(across.said).toContain(
      "A groove 2 mm wide, drawn by shading alone.",
    );
    expect(across.said).toContain(
      "Continuity: its 2 open ends each reach an edge of Case; the curve lies within 0 mm of the surface all along.",
    );
    expect(across.said).toContain(
      "It changes only the relief of Case's surface, pressed 1 mm in",
    );
    expect(short.failed, short.said).toBe(false);
    expect(short.said).toContain(
      "Continuity: of its 2 open ends, 0 reach an edge of Case and 2 stop on its faces, at (-0.1, 3.05, 0.2 m), (0.1, 3.05, 0.2 m): a panel line that stops short of an edge reads as a scratch; the curve stands up to 10 mm off the surface near",
    );
    expect(short.said).toContain("pressed 0.5 mm in");
    expect(loop.failed, loop.said).toBe(false);
    expect(loop.said).toContain(
      "Continuity: it runs unbroken round a closed loop.",
    );
    // The camera looks along +y: the case's sides facing ±x are edge-on to it.
    expect(loop.said).toMatch(
      /In the camera's picture it is up to [\d.]+ px wide, and it reaches Case's outline as the camera sees it near \([^)]*\): a real gap would notch the outline there, which shading cannot; cut it with blender_shape_objects boolean if it must show\./,
    );
    expect(coloured.failed).toBe(true);
    expect(coloured.said).toContain(
      "color is not for a groove strip, which changes only the surface's relief: its colour and finish stay the surface's.",
    );
  });

  it("wraps a paper label round a bottle and a clear one round a tapered jar, giving the arc and the stretch, and shows paper, film and ink", async () => {
    await script(`
import bpy, numpy
img = bpy.data.images.new("band", 200, 100, alpha=True)
px = numpy.zeros((100, 200, 4), dtype=numpy.float32)
px[:, 50:150] = (1, 0, 0, 1)
img.pixels.foreach_set(px.ravel())
img.filepath_raw = "band.png"
img.file_format = "PNG"
img.save()
bpy.data.images.remove(img)
bpy.ops.mesh.primitive_cone_add(vertices=64, radius1=0.05, radius2=0.04, depth=0.2, location=(-6, 0, 0.1))
bpy.context.active_object.name = "Jar"
`);
    await call("blender_add_objects", {
      objects: [
        {
          name: "Bottle",
          kind: "cylinder",
          size: [0.1, 0.1, 0.2],
          location: [-6, -2, 0.1],
          segments: 64,
        },
      ],
    });
    const painted = await call("blender_set_material", {
      objects: ["Bottle", "Jar"],
      material: { name: "Blue glass", color: "#3366cc", roughness: 0.4 },
    });
    expect(painted.failed, painted.said).toBe(false);
    const paper = await call("blender_add_decal", {
      object: "Bottle",
      name: "Paper label",
      kind: "wrap",
      picture: "band.png",
      at: [-6, -2.1, 0.1],
      size: 0.06,
    });
    const clear = await call("blender_add_decal", {
      object: "Jar",
      name: "Clear label",
      kind: "wrap",
      picture: "band.png",
      at: [-6, -0.1, 0.1],
      size: 0.1,
      label: "clear",
      white_ink: false,
    });
    const wide = await call("blender_add_decal", {
      object: "Bottle",
      kind: "wrap",
      text: "ROUND",
      at: [-6, -2.1, 0.1],
      size: 0.4,
    });
    // In front of each label, close: its middle, then 6 px to the left of
    // it, where the band's picture is clear.
    const seen = await script(`
import bpy
s = bpy.context.scene
was = s.camera
cam = bpy.data.objects.new("Near", bpy.data.cameras.new("Near"))
s.collection.objects.link(cam)
cam.rotation_euler = (1.5708, 0, 0)
s.camera = cam
s.render.engine = "CYCLES"
s.cycles.samples = 16
view = s.view_settings.view_transform
s.view_settings.view_transform = "Standard"
s.cycles.device = "CPU"
s.render.resolution_x = s.render.resolution_y = 48
s.render.resolution_percentage = 100
s.render.filepath = bpy.path.abspath("//near.png")
def colour(px, x, y):
    r, g, b = px[(y * 48 + x) * 4 : (y * 48 + x) * 4 + 3]
    return ("red" if r > 2 * max(g, b) else "blue" if b > 1.5 * r else "white" if min(r, g, b) > 0.5 * max(r, g, b) else f"{r:.2f} {g:.2f} {b:.2f}")
# The side looked at lies past the band, which covers the middle half of each label: 20.6 mm left on
# the 60 mm paper label, 28 mm left on the 100 mm clear one.
for name, y, side in (("paper", -2.05, 18), ("clear", -0.045, 16)):
    cam.location = (-6, y - 0.25, 0.1)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(s.render.filepath, check_existing=False)
    px = img.pixels[:]
    print(name, "middle", colour(px, 24, 24), "red", round(px[(24 * 48 + 24) * 4], 2), "side", colour(px, side, 24))
    bpy.data.images.remove(img)
s.camera = was
s.view_settings.view_transform = view
bpy.data.objects.remove(cam)
`);

    expect(paper.failed, paper.said).toBe(false);
    expect(paper.said).toMatch(
      /^Decal “Paper label” on Bottle: band\.png \(200 × 100 px\), 60 × 30 mm, wrapped round its z axis, its middle at \(-6, -2\.05, 0\.1 m\), which faces \([\d.-]+, -0\.99\d?, 0\) there\./m,
    );
    // 60 mm round a radius of 50 mm, its 64 sides 49.94 mm from the axis at their middles: 68.8° or 68.7°.
    expect(paper.said).toMatch(
      /Round its z axis it covers an arc of 68\.[78]°, (50|49\.9\d*) mm from the axis at its middle; the surface keeps that radius across its height, so its width lies as printed\./,
    );
    expect(paper.said).toContain(
      "Its own material “Paper label paper label”: a paper label, printed on white paper #f2f0eb that shows where the picture is clear, roughness 0.6.",
    );
    expect(clear.failed, clear.said).toBe(false);
    // Halfway up, the jar is 45 mm round; across the label's 50 mm of
    // height its radius runs from 43.75 to 46.25 mm: 0.972 to 1.03 times.
    expect(clear.said).toMatch(
      /across its height the surface lies 43\.\d+ to 46\.\d+ mm from the axis, so its width stretches 0\.97\d?× to 1\.03\d?× there\. A label does not stretch: on that profile a real one would crease or stand off at its edges, where a shrink sleeve or print on the surface follows it\./,
    );
    expect(clear.said).toContain(
      "a clear label, a film of roughness 0.15 through which the surface shows where nothing is printed, its ink printed without white under it, so the surface shows through it, tinted.",
    );
    expect(wide.failed).toBe(true);
    // 400 mm round a radius of about 50 mm is 458° or more, once round 314 mm.
    expect(wide.said).toMatch(
      /covers 45[89](\.\d+)?° round a radius of (50|49\.9\d*) mm, more than once round: give a size of at most 31\d(\.\d)? mm\./,
    );
    // Paper shows the ink and white paper; film shows the blue jar beside the
    // ink, and through the ink, which has no white under it, the jar darkens it.
    const [, paperRed] =
      /paper middle red red ([\d.]+) side white/.exec(seen) ?? [];
    const [, clearRed] =
      /clear middle .* red ([\d.]+) side blue/.exec(seen) ?? [];
    expect(paperRed, seen).toBeDefined();
    expect(clearRed, seen).toBeDefined();
    expect(Number(clearRed)).toBeLessThan(Number(paperRed) / 2);
  });
});
