/**
 * What Blender says of its commands as its session starts, and where the
 * tools differ from it. Blender owns what a command does: the choices an
 * input takes, the names an object of it takes, its defaults and its limits.
 * A tool's schema states those the model must be told, the numbers its
 * description and the studio's pages state in words are `statedNumbers`,
 * the defaults they name in words are `statedWords`, and each library
 * function's call in the catalog states its arguments and defaults; each
 * must be Blender's own. A limit or default a schema states is described by
 * Blender, unless Zhiyin holds it itself before a call reaches Blender.
 */

import { libraryFunctions, type LibraryFunction } from "./library-functions.js";
import type { SceneCommand } from "./scene-session.js";
import type { StudioTool } from "./schema-parts.js";
import { statedNumbers, statedWords } from "./stated-numbers.js";

/** The terms Blender holds one input to, in JSON Schema's words. */
type InputTerms = {
  readonly enum?: readonly (string | number)[];
  /** The names an object input takes. */
  readonly properties?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly default?: unknown;
};

/** One command as Blender describes it. */
type DescribedCommand = {
  /** What it does to the scene: changes it, shows it and leaves it as it was, or reads it. */
  readonly kind: "changes" | "shows" | "reads";
  /**
   * Its inputs' terms, by each input's path in its arguments, a list's items
   * under the list's own name: `operations.kind` is each operation's kind.
   */
  readonly inputs?: Readonly<Record<string, InputTerms>>;
  /** The numbers a tool's description states in words, by name. */
  readonly numbers?: Readonly<Record<string, number>>;
  /** The words a tool's description states for a default, by name. */
  readonly words?: Readonly<Record<string, string>>;
  /**
   * The script's: each function of the library scripts reach as `zhiyin`,
   * its arguments and defaults as Python declares them.
   */
  readonly signatures?: Readonly<Record<string, string>>;
};

/** Every command Blender runs, by its name. */
export type CommandsDescription = Readonly<Record<string, DescribedCommand>>;

/** The command each tool's call is sent to Blender as. */
const toolCommands: Readonly<Record<string, SceneCommand>> = {
  blender_open_scene: "open",
  blender_api: "api",
  blender_describe_scene: "describe",
  blender_render: "render",
  blender_frame_sheet: "frames",
  blender_close_ups: "closeups",
  blender_look: "look",
  blender_render_video: "video",
  blender_export: "export",
  blender_add_objects: "add",
  blender_edit_objects: "edit",
  blender_shape_objects: "shape",
  blender_set_material: "material",
  blender_set_camera: "camera",
  blender_set_lighting: "lighting",
  blender_run_script: "script",
  blender_animate: "animate",
  blender_settle_objects: "settle",
  blender_scatter: "scatter",
  blender_measure: "measure",
  blender_unwrap: "unwrap",
  blender_bake: "bake",
  blender_add_decal: "decal",
  blender_rig: "rig",
  blender_simulate: "simulate",
};

/** Limits a schema states that Zhiyin holds a call to before Blender sees it, as "tool input term". */
const heldByZhiyin = new Set(["blender_run_script code maxLength"]);

/**
 * The terms every statement of which in a schema must be Blender's. Item
 * counts also give a value's shape, as a point's three numbers, so they are
 * compared only where Blender describes them.
 */
const heldByBlender = ["minimum", "maximum", "maxLength", "default"] as const;

/** The terms that apply to a list itself rather than to its items. */
const listTerms: ReadonlySet<string> = new Set(["minItems", "maxItems"]);

type Schema = {
  readonly type?: string;
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly items?: Schema;
} & Readonly<Record<string, unknown>>;

/** The schema of the input at `path`, a list's items under the list's own name. */
function inputAt(schema: Schema, path: string): Schema | undefined {
  let node: Schema | undefined = schema;
  for (const name of path.split(".")) {
    if (node?.type === "array" && node.items) node = node.items;
    node = node?.properties?.[name];
  }
  return node;
}

/**
 * What a schema states of one term, read from a list's items unless the term
 * is the list's own: its item counts, or a default it states for the whole
 * list, as a point's.
 */
function stated(node: Schema, term: keyof InputTerms): unknown {
  const holder =
    node.type === "array" &&
    node.items &&
    !listTerms.has(term) &&
    node[term] === undefined
      ? node.items
      : node;
  if (term !== "properties") return holder[term];
  return holder.properties ? Object.keys(holder.properties) : undefined;
}

/** A term's value as compared: choices and names in any order. */
const compared = (term: string, value: unknown) =>
  JSON.stringify(
    (term === "enum" || term === "properties") && Array.isArray(value)
      ? [...value].map(String).sort()
      : value,
  );

const shown = (value: unknown) =>
  Array.isArray(value) ? value.join(", ") : JSON.stringify(value);

/** Every limit and default a schema states, with the input's path. */
function* limitsIn(
  node: Schema,
  path: string,
): Generator<readonly [string, (typeof heldByBlender)[number], unknown]> {
  for (const term of heldByBlender)
    if (node[term] !== undefined) yield [path, term, node[term]];
  for (const [name, child] of Object.entries(node.properties ?? {}))
    yield* limitsIn(child, path ? `${path}.${name}` : name);
  if (node.items) yield* limitsIn(node.items, path);
}

/**
 * Where the tools and the numbers their descriptions state differ from what
 * Blender says of its commands, each in a sentence; none when they agree.
 */
export function differencesFrom(
  tools: readonly StudioTool[],
  commands: CommandsDescription,
  libraries: readonly LibraryFunction[] = libraryFunctions,
): string[] {
  const found: string[] = [];
  const sent = new Set<string>();
  for (const tool of tools) {
    const command = toolCommands[tool.name];
    if (!command) {
      found.push(`${tool.name}: no command is known for it.`);
      continue;
    }
    sent.add(command);
    const described = commands[command];
    if (!described) {
      found.push(
        `${tool.name} is sent as ${command}, which Blender does not describe.`,
      );
      continue;
    }
    const schema = tool.inputSchema as unknown as Schema;
    const inputs = described.inputs ?? {};
    for (const [path, terms] of Object.entries(inputs)) {
      const node = inputAt(schema, path);
      if (!node) {
        found.push(
          `${tool.name} ${path}: Blender describes it, and the schema has no such input.`,
        );
        continue;
      }
      for (const [term, value] of Object.entries(terms)) {
        const ours = stated(node, term as keyof InputTerms);
        if (
          ours === undefined ||
          compared(term, ours) === compared(term, value)
        )
          continue;
        found.push(
          `${tool.name} ${path} ${term}: ${shown(ours)} in the schema, ${shown(value)} in Blender.`,
        );
      }
    }
    for (const [path, term, value] of limitsIn(schema, "")) {
      if (heldByZhiyin.has(`${tool.name} ${path} ${term}`)) continue;
      if (inputs[path]?.[term] === undefined)
        found.push(
          `${tool.name} ${path} ${term}: the schema states ${shown(value)}, and Blender does not describe it.`,
        );
    }
  }
  for (const [command, described] of Object.entries(commands))
    if (described.inputs && !sent.has(command))
      found.push(
        `${command}: Blender describes its inputs, and no tool sends it.`,
      );
  for (const [field, stated] of [
    ["numbers", statedNumbers],
    ["words", statedWords],
  ] as const)
    for (const [command, values] of Object.entries(stated))
      for (const [name, value] of Object.entries(values)) {
        const theirs = commands[command]?.[field]?.[name];
        if (theirs !== value)
          found.push(
            theirs === undefined
              ? `${command} ${name}: a tool states ${value}, and Blender does not describe it.`
              : `${command} ${name}: a tool states ${value}, Blender holds ${theirs}.`,
          );
      }
  found.push(...signatureDifferences(libraries, commands));
  return found;
}

/**
 * A call as the catalog writes it, `zhiyin.name(arguments)`, as Python
 * writes the function's signature: its arguments in brackets, each text in
 * single quotes.
 */
const asPython = (call: string) =>
  call
    .slice(call.indexOf("("))
    .replace(/"([^"']*)"/g, (_, text: string) => `'${text}'`);

/**
 * Where a library function's call, as the catalog lists it, differs from
 * its signature as Blender's Python declares it, each in a sentence.
 */
function signatureDifferences(
  listed: readonly LibraryFunction[],
  commands: CommandsDescription,
): string[] {
  const declared = commands["script"]?.signatures ?? {};
  const found: string[] = [];
  for (const fn of listed) {
    const theirs = declared[fn.name];
    const ours = asPython(fn.call);
    if (theirs === undefined)
      found.push(
        `zhiyin.${fn.name}: the catalog lists it, and Blender does not describe it.`,
      );
    else if (theirs !== ours)
      found.push(
        `zhiyin.${fn.name}: the catalog states ${ours}, Blender declares ${theirs}.`,
      );
  }
  const names = new Set(listed.map((fn) => fn.name));
  for (const name of Object.keys(declared))
    if (!names.has(name))
      found.push(
        `zhiyin.${name}: Blender declares it, and the catalog does not list it.`,
      );
  return found;
}
