import type { LibraryFunction } from "./library-function.js";

export const stylisedFunctions: readonly LibraryFunction[] = [
  {
    name: "toon",
    call: "zhiyin.toon(material, bands=3, *, shadow=0.35, shadow_color=None, rim=None, faceted=False)",
    summary:
      "Shade a material in flat bands of light, as a cartoon or cel look, built onto it: its colour, or the picture that colours it, kept.",
    arguments: [
      "material: a material or its name.",
      "bands: how many steps of light, 1 to 8.",
      "shadow: the share of its colour the darkest band shows, 0 to 1.",
      'shadow_color: or a tint the darkest band multiplies the colour by, as #rrggbb, for coloured shadows such as "#6070a0"; not with shadow.',
      'rim: {"color": "#rrggbb", "width": 0.2}, a glow round the shape\'s edge as the camera sees it, over the outer share of its turn away.',
      "faceted: True shades each face flat by its own normal.",
    ],
    example:
      'zhiyin.toon("Body paint", bands=3, shadow_color="#5a5f8c", rim={"color": "#ffffff", "width": 0.15})',
    reports:
      "the bands, darkest first, as colours and shares or tints of the material's colour, the rim, how each engine draws them (EEVEE: Shader to RGB through a constant ramp; Cycles: Toon BSDFs stepped by the angle to the light), and the objects that wear it. An EEVEE render of it is the picture to hand over, and says how many flat colours each toon shape shows against its bands. blender_set_material's toon does the same.",
    terms: [
      "toon",
      "cel shading",
      "cartoon",
      "NPR",
      "anime",
      "shader to rgb",
      "color ramp",
      "banded",
      "flat shading",
      "rim light",
      "stylised",
    ],
  },
  {
    name: "outline",
    call: 'zhiyin.outline(objects, thickness=2, *, color="#000000")',
    summary:
      "Outline meshes with an inverted hull: a dark shell round each, drawn only past the shape's edge, in Cycles and EEVEE.",
    arguments: [
      "objects: a mesh object, its name, or a list of them.",
      "thickness: the line's width in pixels of the camera's picture, at each object's distance.",
      "color: the line's colour, as #rrggbb.",
    ],
    example: 'zhiyin.outline(["Robot", "Robot arm"], thickness=3)',
    reports:
      "each object's hull width in millimetres and its distance from the camera; with no camera it is refused, the width being in pixels of its picture. blender_set_camera's outlines draws Freestyle or Line Art lines instead, and a render says how much of each silhouette has its line.",
    terms: [
      "outline",
      "inverted hull",
      "ink",
      "contour",
      "silhouette",
      "toon",
      "lines",
      "stylised",
    ],
  },
  {
    name: "post",
    call: "zhiyin.post(steps)",
    summary:
      "Lay compositor steps over every render and video, in order, as blender_render's post does: glare, lens distortion, sharpen, colour balance, a painterly filter and Blender's bundled groups.",
    arguments: [
      'steps: a list of {"step", "amount", "threshold", "inputs"}: step is bloom, glow, streaks, ghosts, star, sun_beams, lens_distortion, sharpen, color_balance, painterly, vignette, film_grain, sensor_noise, chromatic_aberration, sepia, split_toning, unsharp_mask or tune_image; amount mixes it in, 0 to 1; threshold is a glare\'s; inputs sets its own inputs by Blender\'s names. [] removes them.',
    ],
    example:
      'zhiyin.post([{"step": "bloom", "amount": 0.6}, {"step": "vignette", "inputs": {"Feather": 0.4}}])',
    reports:
      "each step in order with its amount and every input as Blender holds it, a value past its range, and the scene's own compositor it replaces; a glare without a threshold glows past one measured from each picture blender_render makes. Returns the compositor group, which a script can add nodes to.",
    terms: [
      "compositor",
      "compositing",
      "post",
      "post-processing",
      "bloom",
      "glow",
      "glare",
      "streaks",
      "lens distortion",
      "sharpen",
      "color balance",
      "kuwahara",
      "painterly",
      "vignette",
      "film grain",
    ],
  },
  {
    name: "compositor_group",
    call: "zhiyin.compositor_group(name)",
    summary:
      "Append one of Blender's bundled compositor groups by its name, kept in the file, to build into a compositor tree.",
    arguments: [
      "name: one of Vignette, Film Grain, Sensor Noise, Chromatic Aberration, Sepia, Split Toning, Tune Image, Unsharp Mask, Retime, Separate Spherical, Combine Spherical, Separate Cylindrical, Combine Cylindrical, 3D to Screen Space, Screen to 3D Space, Transform and Project or Project with Depth.",
    ],
    example:
      'tree = zhiyin.post([{"step": "vignette"}])\nnode = tree.nodes.new("CompositorNodeGroup")\nnode.node_tree = zhiyin.compositor_group("Retime")',
    reports:
      "the group's inputs and outputs with their kinds, and how it goes in a compositor tree; a name Blender does not bundle is refused with those it does.",
    terms: [
      "compositor",
      "node group",
      "asset",
      "bundled",
      "retime",
      "spherical",
      "cylindrical",
      "screen space",
      "project with depth",
    ],
  },
];
