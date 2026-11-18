import type { PartModel, PartsPanelState } from "@zhiyin/contract";
// A plate and a pin written by the CAD studio's own preview writer.
import sample from "./sample-parts.glb?url";

export const plateAndPin: PartsPanelState = {
  sequence: 1,
  parts: [
    { name: "Plate", size: [120, 80, 10], valid: true },
    { name: "Pin", size: [19.6, 19.6, 30], valid: true },
  ],
  script: "fixtures/mounting-plate.py",
};

/** A build whose second part is not a valid solid, with a name too long for one line. */
export const brokenBracket: PartsPanelState = {
  sequence: 2,
  parts: [
    { name: "Shelf bracket, left side", size: [140, 30, 120.5], valid: true },
    {
      name: "Countersunk screw boss for the wall plate",
      size: [12, 12, 0],
      valid: false,
    },
  ],
};

/** A build of many parts, more than the list shows at once beside a drawing. */
export const gearTrain: PartsPanelState = {
  sequence: 3,
  parts: [
    ...brokenBracket.parts,
    ...Array.from({ length: 58 }, (_, index) => ({
      name: `Gear ${index + 1}`,
      size: [24 + index, 24 + index, 6] as const,
      valid: true,
    })),
  ],
  script: "fixtures/gear-train.py",
};

/** The sample mesh, as the core hands it to the window. */
export async function sampleModel(sequence: number): Promise<PartModel> {
  const data = new Uint8Array(await (await fetch(sample)).arrayBuffer());
  return { sequence, data };
}
