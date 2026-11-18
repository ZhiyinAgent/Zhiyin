/**
 * The pages on what changed in Blender's Python API since the Blenders
 * models were trained on: one sheet of every change the studio knows, those
 * a script meets as an error and those it runs through in silence, and the
 * Noise texture as 4.1 rebuilt it with the Musgrave texture inside it.
 */

import { apiBreaks } from "./api-breaks.js";
import { quietChanges } from "./quiet-changes.js";
import type { WrittenPage } from "./written-pages.js";

const lines = (...said: string[]) => said.join("\n");

export const apiChangesPage: WrittenPage = {
  id: "doc:3d-rendering/api-changes",
  title: "Blender 5.2 for scripts written for 3.x and 4.0",
  summary:
    "Every change in Blender's Python API the studio knows, from 3.x and 4.0 to 5.2: the old form, what 5.2 does with it and the form that works, those that fail and those that run without an error.",
  terms: [
    "blender_run_script",
    "api",
    "changed",
    "deprecated",
    "removed",
    "renamed",
    "5.2",
    "4.0",
    "blend_method",
    "use_nodes",
    "displacement_method",
    "colorspace",
    "Musgrave",
  ],
  text: lines(
    "A script written for an earlier Blender meets each of these in Blender 5.2. A failed script's answer names the change its error shows; a script is read before it runs for the changes that raise no error, and its answer names those too.",
    "",
    "Fail in 5.2, with the form that works:",
    ...apiBreaks.map(
      (change) => `- ${change.title}: ${change.wrong} → ${change.right}`,
    ),
    "",
    "Run without an error in 5.2, doing other than they meant:",
    ...quietChanges.map(
      (change) => `- ${change.title}: ${change.wrong} → ${change.said}`,
    ),
    "",
    "The Noise texture as 4.1 rebuilt it, the Musgrave texture inside it: open doc:3d-rendering/noise-texture. Blender's API as this Blender has it: open doc:blender/api.",
  ),
};

export const noiseTexturePage: WrittenPage = {
  id: "doc:3d-rendering/noise-texture",
  title: "The Noise texture since 4.1, and the Musgrave texture in it",
  summary:
    "How a script written for the Musgrave texture becomes a Noise texture in Blender 5.2: noise_type, Dimension to Roughness, Detail less 1, and the inputs each type reads.",
  terms: [
    "ShaderNodeTexNoise",
    "ShaderNodeTexMusgrave",
    "Musgrave",
    "noise",
    "noise_type",
    "fbm",
    "multifractal",
    "ridged",
    "hetero",
    "Dimension",
    "Roughness",
    "Lacunarity",
    "Detail",
    "Voronoi",
  ],
  text: lines(
    "Blender 4.1 replaced the Musgrave texture with the Noise texture: nodes.new('ShaderNodeTexMusgrave') fails in 5.2, and nodes.new('ShaderNodeTexNoise') draws each Musgrave type by its noise_type, under the same names: 'FBM' (the default, the old Noise texture), 'MULTIFRACTAL', 'RIDGED_MULTIFRACTAL', 'HYBRID_MULTIFRACTAL' and 'HETERO_TERRAIN'.",
    "",
    "From a Musgrave node's values to a Noise node's:",
    "- Dimension is gone: Roughness = Lacunarity ** -Dimension. Dimension 2 at Lacunarity 2 is Roughness 0.25; Dimension 0 is Roughness 1.",
    "- Detail = the Musgrave Detail - 1: its Detail 3 is the Noise texture's 2.",
    "- Scale, Lacunarity, Offset and Gain keep their names and values.",
    "Blender converts the nodes of a file saved before 4.1 itself, and draws them the same.",
    "",
    "The inputs each type reads, besides Vector (or W in 1D and 4D): FBM and MULTIFRACTAL read Scale, Detail, Roughness, Lacunarity and Distortion; RIDGED_MULTIFRACTAL and HYBRID_MULTIFRACTAL read Offset and Gain as well; HETERO_TERRAIN reads Offset but not Gain. Every type takes Distortion and gives Color, which the Musgrave texture did not.",
    "",
    "Since 4.0 the Noise texture has Lacunarity, how much finer each layer of detail is than the last, and normalize, which keeps its output within 0 to 1. The Voronoi texture has Detail, Roughness, Lacunarity and normalize of the same kind.",
    "",
    "Its first output reads as Factor, and is found as outputs['Fac'] or outputs['Factor'].",
  ),
};
