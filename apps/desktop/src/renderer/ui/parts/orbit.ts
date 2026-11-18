/**
 * Where the part view looks from: round the parts, above or below them, and
 * how far, as a share of the distance that fits them whole. Turning keeps
 * short of straight above or below, where "round" would have no meaning, and
 * zooming keeps the parts between a close look and a small whole.
 */
export type Orbit = {
  /** Degrees round the parts, from the front. */
  readonly yaw: number;
  /** Degrees above the parts; below them when negative. */
  readonly pitch: number;
  /** The distance, as a share of the one that fits the parts whole. */
  readonly distance: number;
};

/** A three-quarter view from the front and above, the parts whole. */
export const startingOrbit: Orbit = { yaw: -35, pitch: 25, distance: 1 };

const steepest = 85;
const closest = 0.15;
const farthest = 6;

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** The orbit turned by these degrees, round and up. */
export function turned(orbit: Orbit, yaw: number, pitch: number): Orbit {
  return {
    ...orbit,
    // Kept within one turn, so a long drag never grows the number without end.
    yaw: ((((orbit.yaw + yaw + 180) % 360) + 360) % 360) - 180,
    pitch: clamp(orbit.pitch + pitch, -steepest, steepest),
  };
}

/** The orbit brought closer by `factor` (above 1), or further (below 1). */
export function zoomed(orbit: Orbit, factor: number): Orbit {
  return {
    ...orbit,
    distance: clamp(orbit.distance / factor, closest, farthest),
  };
}

/** Where the camera stands for this orbit, round a centre, at a fitting distance. */
export function cameraPosition(
  orbit: Orbit,
  centre: readonly [number, number, number],
  fits: number,
): [number, number, number] {
  const yaw = (orbit.yaw * Math.PI) / 180;
  const pitch = (orbit.pitch * Math.PI) / 180;
  const reach = fits * orbit.distance;
  return [
    centre[0] + reach * Math.cos(pitch) * Math.sin(yaw),
    centre[1] + reach * Math.sin(pitch),
    centre[2] + reach * Math.cos(pitch) * Math.cos(yaw),
  ];
}

/**
 * How far the camera stands, for the starting orbit, so the corners of the
 * parts' box all fit the view, its narrower side included, with a margin.
 * Measured on the box, not on a sphere round it, so a flat plate fills the
 * view as a cube does. Corners are given from the box's centre.
 */
export function fittingDistance(
  corners: readonly (readonly [number, number, number])[],
  fieldOfView: number,
  aspect: number,
): number {
  const [dx, dy, dz] = cameraPosition(startingOrbit, [0, 0, 0], 1);
  // Right and up as the camera sees them, the world's up being y.
  const rightLength = Math.hypot(dz, dx);
  const right = [dz / rightLength, 0, -dx / rightLength];
  const up = [
    dy * right[2]! - dz * right[1]!,
    dz * right[0]! - dx * right[2]!,
    dx * right[1]! - dy * right[0]!,
  ];
  const tall = Math.tan((fieldOfView * Math.PI) / 360);
  const wide = tall * aspect;
  let distance = 0;
  for (const [x, y, z] of corners) {
    const across = x * right[0]! + y * right[1]! + z * right[2]!;
    const above = x * up[0]! + y * up[1]! + z * up[2]!;
    const toward = x * dx + y * dy + z * dz;
    distance = Math.max(
      distance,
      toward + Math.abs(across) / wide,
      toward + Math.abs(above) / tall,
    );
  }
  return distance * 1.15;
}
