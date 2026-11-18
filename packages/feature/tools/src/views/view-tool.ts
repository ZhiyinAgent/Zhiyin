import type {
  ProducedView,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
  ViewKind,
} from "@zhiyin/contract";
import { schemaProblems, unusedFields } from "@zhiyin/tool-input";

/** A chart or a diagram shown in the conversation, which needs no folder. */
export type ViewTool = {
  readonly spec: ToolSpec;
  readonly requiresWorkspace: false;
  readonly inspect: (args: unknown) => Promise<ToolCallInspection>;
  readonly execute: (args: unknown) => Promise<ToolInvocationResult>;
};

type Schema = { readonly properties?: Readonly<Record<string, unknown>> };

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The input with the spaces around each text taken off: what a view and a
 * question show, so its schema's bounds count no spaces around a text, and a
 * text of spaces alone is empty.
 */
export function withoutSpacesAround(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(withoutSpacesAround);
  const record = object(value);
  return record
    ? Object.fromEntries(
        Object.entries(record).map(([key, item]) => [
          key,
          withoutSpacesAround(item),
        ]),
      )
    : value;
}

/**
 * Why the input does not hold to the schema, in words, or nothing. `what`
 * names what is shown, as "A bar chart".
 */
export function inputProblems(
  input: unknown,
  schema: unknown,
  what: string,
): string | undefined {
  const problems = schemaProblems(input, schema);
  return problems.length
    ? `${what} cannot be shown as given: ${problems.join("; ")}.`
    : undefined;
}

/** “a”, “a” and “b”, “a”, “b” and “c”: names as a sentence lists them. */
function listed(names: readonly string[], quote = false): string {
  const shown = quote ? names.map((name) => `“${name}”`) : names;
  return shown.length < 2
    ? (shown[0] ?? "")
    : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)!}`;
}

/** The schema of the item a place names, as `series[0].points[1]`. */
function schemaOfItem(schema: unknown, place: string): Schema | undefined {
  let at: unknown = schema;
  for (const step of place.match(/[^.[\]]+|\[\d+\]/g) ?? [])
    at = step.startsWith("[")
      ? object(at)?.["items"]
      : object(object(at)?.["properties"])?.[step];
  return object(at) as Schema | undefined;
}

/**
 * Why an item cannot be drawn as given: it holds an input the view has no
 * mark for, which would otherwise be accepted and silently not drawn. The
 * item is the first with such an input; `items` names each kind of item by
 * its place with the list positions left out, as `series[].points[]`, and
 * `what` the view itself.
 */
function unknownFields(
  args: unknown,
  schema: unknown,
  what: string,
  items: Readonly<Record<string, string>>,
): string | undefined {
  const [first, ...rest] = unusedFields(args, schema).map((field) => {
    const cut = field.lastIndexOf(".");
    return {
      item: cut < 0 ? "" : field.slice(0, cut),
      name: field.slice(cut + 1),
    };
  });
  if (!first) return undefined;
  const extra = [first, ...rest]
    .filter((field) => field.item === first.item)
    .map((field) => field.name);
  const known = Object.keys(schemaOfItem(schema, first.item)?.properties ?? {});
  const named = first.item
    ? (items[first.item.replace(/\[\d+\]/g, "[]")] ?? what)
    : what;
  return `${named} has ${listed(known)} only, so ${listed(extra, true)} cannot be drawn. Leave ${extra.length === 1 ? "it" : "them"} out, or draw the chart another way.`;
}

/**
 * A refusal of a call that only shows something in the conversation, a view or
 * a question.
 */
export function correctable(reason: string): ToolCallInspection {
  return { ok: false, reason, correctable: true };
}

/** Each kind of view as a sentence names it. */
const viewNames: Record<ViewKind, string> = {
  diagram: "A diagram",
  "bar-chart": "A bar chart",
  "line-chart": "A line chart",
  "scatter-plot": "A scatter plot",
  histogram: "A histogram",
  "box-plot": "A box plot",
};

/**
 * Said by every view: what it draws is shown in the conversation, and a file
 * that refers to it as though it held it points at nothing.
 */
const shownInConversation =
  "What it draws is shown in the conversation and is not embedded in any other file: never write a heading or a sentence in a file that refers to it as though it were inside that file. If a document itself needs a chart, build one in that document's own format, and say plainly where each thing ended up.";

/** Where a view's drawing is saved, through write_file (ADR 0003). */
const saveToSchema = {
  type: "string",
  minLength: 5,
  maxLength: 500,
  description:
    "A workspace path ending in .svg to save the drawing to as well, the file the person's Save writes, such as charts/sales.svg; written through write_file, which asks as any write does.",
} as const;

const notSvg =
  "save_to names the .svg file the drawing is saved to, such as charts/sales.svg.";

/**
 * A view tool: its spec, and how an input that holds to the spec's schema,
 * with no spaces around its texts, becomes what is drawn, or why it cannot
 * for what a schema cannot say. `items` names each kind of item in the input
 * by its place, as `series[]` is "A line series".
 */
export function defineViewTool<Input>(
  given: ToolSpec,
  action: string,
  kind: ViewKind,
  parse: (input: Input) => { title: string; data: unknown } | string,
  items: Readonly<Record<string, string>> = {},
): ViewTool {
  const schema = given.inputSchema as {
    properties?: Record<string, unknown>;
  };
  const spec: ToolSpec = {
    ...given,
    description: `${given.description} ${kind === "diagram" ? "" : "When a person asks for a chart, use the render tool of its kind. "}${shownInConversation}`,
    inputSchema: {
      ...schema,
      properties: { ...schema.properties, save_to: saveToSchema },
    },
  };
  async function inspect(args: unknown): Promise<ToolCallInspection> {
    const input = withoutSpacesAround(args);
    const problem =
      unknownFields(input, spec.inputSchema, viewNames[kind], items) ??
      inputProblems(input, spec.inputSchema, viewNames[kind]);
    if (problem) return correctable(problem);
    const { save_to: saveTo, ...drawn } = input as {
      readonly save_to?: string;
    };
    if (saveTo !== undefined && !/\.svg$/i.test(saveTo))
      return correctable(notSvg);
    const parsed = parse(drawn as Input);
    if (typeof parsed === "string") return correctable(parsed);
    const view: ProducedView = {
      kind,
      title: parsed.title,
      source:
        kind === "diagram"
          ? (parsed.data as string)
          : JSON.stringify(parsed.data),
      ...(saveTo ? { saveTo } : {}),
    };
    return {
      ok: true,
      action,
      target: parsed.title,
      command: `${spec.name}(${JSON.stringify({ title: parsed.title })})`,
      requiresApproval: false,
      view,
    };
  }

  return {
    spec,
    requiresWorkspace: false,
    inspect,
    execute: async (args) => {
      const inspection = await inspect(args);
      return inspection.ok && inspection.view
        ? {
            ok: true,
            value: { kind, title: inspection.view.title },
            view: inspection.view,
          }
        : {
            ok: false,
            reason: inspection.ok
              ? "The view could not be produced."
              : inspection.reason,
          };
    },
  };
}

/** A chart's title. */
export const titleSchema = {
  type: "string",
  minLength: 1,
  maxLength: 160,
} as const;

/** A label or name in a chart: a category's, a series', a point's. */
export const nameSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
} as const;

/** The optional texts every chart takes. */
export const chartTextSchemas = {
  xLabel: { ...nameSchema, description: "The horizontal axis's name." },
  yLabel: { ...nameSchema, description: "The vertical axis's name." },
  unit: {
    ...nameSchema,
    description:
      "The unit of the measured values, shown after the axis name, as “Revenue (EUR)”.",
  },
  omitted: {
    type: "string",
    minLength: 1,
    maxLength: 500,
    description:
      "What the chart leaves out, such as rows sampled or cut to fit its limits; shown under it as “Not shown: …”.",
  },
} as const;

/** The texts every chart takes, as its input gives them. */
export type ChartTexts = {
  readonly title: string;
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly unit?: string;
  readonly omitted?: string;
};
