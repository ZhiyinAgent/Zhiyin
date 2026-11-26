/** The pieces the studio's tool schemas are built from. */

export type StudioTool = {
  readonly name: string;
  /** What the person reads while a call to it is written, as its approval names it. */
  readonly label: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** Its answer says how the whole scene stands now. */
  readonly reportsState?: true;
  /** It only reads the scene: a reviewer may be offered it. */
  readonly access?: "read";
  /** How a call checks work, as a `ToolSpec` says. */
  readonly checksWork?: "runs" | "shows";
  /** The toolkit it loads with (ADR 0017); none for a core tool. */
  readonly toolkit?: string;
};

export const vector3 = (description: string) => ({
  type: "array",
  items: { type: "number" },
  minItems: 3,
  maxItems: 3,
  description,
});
/** Where an object's origin goes: across only, for an object set down. */
export const setDownLocation = (description: string) => ({
  type: "array",
  items: { type: "number" },
  minItems: 2,
  maxItems: 3,
  description: `${description}: [x, y, z], or [x, y] with rest_on or rest_across, which set the height.`,
});
export const point2 = {
  type: "array",
  items: { type: "number" },
  minItems: 2,
  maxItems: 2,
};
export const colour = (description: string) => ({
  type: "string",
  pattern: "^#?[0-9a-fA-F]{6}$",
  description,
});
export const workspaceFile = (description: string) => ({
  type: "string",
  description,
});

/** Objects named, or matched by a pattern between slashes. */
export const objectNames = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  description:
    "Names of objects in the scene. A name between slashes, such as /Spring_.*/, stands for every object whose whole name it matches; the answer says which.",
};
