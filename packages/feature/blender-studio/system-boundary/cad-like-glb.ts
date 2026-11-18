/**
 * Model files written as the CAD studio writes them, for the 3D studio's
 * tests that run without the CAD environment: each part a box whose six
 * faces are each a run of points of their own, with their own normals, the
 * mesh marked as a CAD part's, and groups of surfaces drawn with materials of
 * their names. Sizes in metres, z up, written with y up as glTF has it.
 */

import { CAD_PART_EXTRAS, type CadPartExtras } from "@zhiyin/contract";

type Box = {
  readonly name: string;
  readonly size: readonly [number, number, number];
  readonly at?: readonly [number, number, number];
  /** Groups of surfaces by the faces they hold: "top", "bottom", "left", "right", "front", "back". */
  readonly surfaces?: Readonly<Record<string, readonly Side[]>>;
  /** The order the groups are drawn in, "" for the rest; by default the groups, then the rest. */
  readonly order?: readonly string[];
  /**
   * The part's exact size, in metres along its own axes, as the CAD studio
   * measures it and writes it beside the mesh, whose facets only approach it.
   */
  readonly cadSize?: readonly [number, number, number];
};

type Side = "top" | "bottom" | "left" | "right" | "front" | "back";

const sides: Record<
  Side,
  { normal: [number, number, number]; corners: [number, number, number][] }
> = {
  top: {
    normal: [0, 0, 1],
    corners: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  },
  bottom: {
    normal: [0, 0, -1],
    corners: [
      [-1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
      [1, -1, -1],
    ],
  },
  right: {
    normal: [1, 0, 0],
    corners: [
      [1, -1, -1],
      [1, 1, -1],
      [1, 1, 1],
      [1, -1, 1],
    ],
  },
  left: {
    normal: [-1, 0, 0],
    corners: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1],
    ],
  },
  back: {
    normal: [0, 1, 0],
    corners: [
      [-1, 1, -1],
      [-1, 1, 1],
      [1, 1, 1],
      [1, 1, -1],
    ],
  },
  front: {
    normal: [0, -1, 0],
    corners: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1],
    ],
  },
};

/** z up to glTF's y up. */
const toGltf = ([x, y, z]: readonly number[]) => [x!, z!, -y!];

export function cadLikeGlb(boxes: readonly Box[]): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  const views: object[] = [];
  const accessors: object[] = [];
  const add = (
    data: Buffer,
    componentType: number,
    count: number,
    type: string,
    extra: object = {},
  ) => {
    const padded = Buffer.concat([
      data,
      Buffer.alloc((4 - (data.length % 4)) % 4),
    ]);
    views.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    chunks.push(padded);
    offset += padded.length;
    accessors.push({
      bufferView: views.length - 1,
      componentType,
      count,
      type,
      ...extra,
    });
    return accessors.length - 1;
  };
  const materials: string[] = [];
  const meshes = boxes.map((box) => {
    const half = box.size.map((s) => s / 2);
    const points: number[] = [];
    const normals: number[] = [];
    const faceStart: Partial<Record<Side, number>> = {};
    (Object.keys(sides) as Side[]).forEach((side) => {
      faceStart[side] = points.length / 3;
      for (const corner of sides[side].corners) {
        points.push(
          ...toGltf(corner.map((c, i) => c * half[i]! + (box.at?.[i] ?? 0))),
        );
        normals.push(...toGltf(sides[side].normal));
      }
    });
    const position = Buffer.alloc(points.length * 4);
    points.forEach((v, i) => position.writeFloatLE(v, i * 4));
    const normal = Buffer.alloc(normals.length * 4);
    normals.forEach((v, i) => normal.writeFloatLE(v, i * 4));
    const lows = [0, 1, 2].map((k) =>
      Math.min(...points.filter((_, i) => i % 3 === k)),
    );
    const highs = [0, 1, 2].map((k) =>
      Math.max(...points.filter((_, i) => i % 3 === k)),
    );
    const attributes = {
      POSITION: add(position, 5126, points.length / 3, "VEC3", {
        min: lows,
        max: highs,
      }),
      NORMAL: add(normal, 5126, normals.length / 3, "VEC3"),
    };
    const groups = box.surfaces ?? {};
    const order = box.order ?? [...Object.keys(groups), ""];
    const grouped = new Set(Object.values(groups).flat());
    const primitives = order
      .map((group) => {
        const faces = group
          ? groups[group]!
          : (Object.keys(sides) as Side[]).filter((side) => !grouped.has(side));
        if (!faces.length) return undefined;
        const indices: number[] = [];
        for (const side of faces) {
          const s = faceStart[side]!;
          indices.push(s, s + 1, s + 2, s, s + 2, s + 3);
        }
        const data = Buffer.alloc(indices.length * 4);
        indices.forEach((v, i) => data.writeUInt32LE(v, i * 4));
        const primitive: Record<string, unknown> = {
          attributes,
          indices: add(data, 5125, indices.length, "SCALAR"),
          mode: 4,
        };
        if (group) {
          if (!materials.includes(group)) materials.push(group);
          primitive["material"] = materials.indexOf(group);
        }
        return primitive;
      })
      .filter(Boolean);
    // In the contract's names, with the size left out where a test leaves it out.
    const extras: Partial<CadPartExtras> = {
      [CAD_PART_EXTRAS.part]: box.name,
      ...(Object.keys(groups).length
        ? { [CAD_PART_EXTRAS.surfaces]: order }
        : {}),
      ...(box.cadSize ? { [CAD_PART_EXTRAS.size]: box.cadSize } : {}),
    };
    return { name: box.name, primitives, extras };
  });
  const json = {
    asset: { version: "2.0", generator: "Zhiyin CAD studio" },
    scene: 0,
    scenes: [{ nodes: boxes.map((_, i) => i) }],
    nodes: boxes.map((box, i) => ({ name: box.name, mesh: i })),
    meshes,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
    ...(materials.length
      ? {
          materials: materials.map((name) => ({
            name,
            pbrMetallicRoughness: {
              baseColorFactor: [0.8, 0.8, 0.8, 1],
              metallicFactor: 0,
              roughnessFactor: 0.5,
            },
          })),
        }
      : {}),
  };
  let text = Buffer.from(JSON.stringify(json), "utf8");
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const binary = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + binary.length, 8);
  const textHead = Buffer.alloc(8);
  textHead.writeUInt32LE(text.length, 0);
  textHead.write("JSON", 4, "latin1");
  const binaryHead = Buffer.alloc(8);
  binaryHead.writeUInt32LE(binary.length, 0);
  binaryHead.write("BIN\0", 4, "latin1");
  return Buffer.concat([header, textHead, text, binaryHead, binary]);
}
