/** What the person and the model read about this PC and Blender. */

export const notInstalled =
  "Blender is not installed. Install it from the 3D & Rendering plugin first.";

/**
 * Said once to the person and the model on a PC whose graphics card Blender
 * cannot draw on, `device` being what Cycles draws on there.
 */
export const drawsWithout = (device: string) =>
  device === "the processor"
    ? "This computer's graphics card cannot draw Blender's pictures, so Blender draws them on the processor, which takes longer."
    : `This computer's graphics card cannot draw Blender's quick pictures, so Blender draws every picture with Cycles on ${device}, which takes longer.`;
