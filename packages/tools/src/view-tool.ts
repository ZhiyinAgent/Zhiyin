import type {
  ProducedView,
  ToolCallInspection,
  ToolInvocationResult,
  ToolSpec,
  ViewKind,
} from "@zhiyin/contract";

export type ViewTool = {
  readonly spec: ToolSpec;
  readonly inspect: (args: unknown) => Promise<ToolCallInspection>;
  readonly execute: (args: unknown) => Promise<ToolInvocationResult>;
};

export function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function requiredText(
  value: unknown,
  maximum = 160,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  // Counted in characters, as a schema's bound is, not JavaScript units.
  return trimmed && [...trimmed].length <= maximum ? trimmed : undefined;
}

export function optionalText(
  value: unknown,
  maximum = 120,
): string | undefined | null {
  if (value === undefined) return undefined;
  return requiredText(value, maximum) ?? null;
}

export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A refusal of a call that only shows something in the conversation, a view or
 * a question. Nothing it shows reaches past the conversation, so a repair may
 * change any of its inputs (ADR 0010).
 */
export function correctable(reason: string, args: unknown): ToolCallInspection {
  const faulty = Object.keys(object(args) ?? {});
  return {
    ok: false,
    reason,
    correctable: true,
    ...(faulty.length ? { faulty } : {}),
  };
}

export function defineViewTool(
  spec: ToolSpec,
  action: string,
  kind: ViewKind,
  parse: (args: unknown) => { title: string; data: unknown } | string,
): ViewTool {
  async function inspect(args: unknown): Promise<ToolCallInspection> {
    const parsed = parse(args);
    if (typeof parsed === "string") return correctable(parsed, args);
    const view: ProducedView = {
      kind,
      title: parsed.title,
      source:
        kind === "diagram"
          ? (parsed.data as string)
          : JSON.stringify(parsed.data),
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

/** A chart's title, advertised with the bound `requiredText` keeps. */
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

/** The longest note a chart takes on what it leaves out. */
const longestOmitted = 500;

/** The optional texts every chart takes, as its schema advertises them. */
export const chartTextSchemas = {
  xLabel: nameSchema,
  yLabel: nameSchema,
  unit: nameSchema,
  omitted: { type: "string", minLength: 1, maxLength: longestOmitted },
} as const;

/**
 * The axis labels, unit and note on what was left out, as given, or why one
 * is refused: each is either left out or within its bound.
 */
export function chartLabels(
  item: Record<string, unknown>,
): Record<string, string> | string {
  const data: Record<string, string> = {};
  for (const field of ["xLabel", "yLabel", "unit", "omitted"] as const) {
    const longest = field === "omitted" ? longestOmitted : 120;
    const value = optionalText(item[field], longest);
    if (value === null)
      return `${field} must be non-empty text no longer than ${longest} characters.`;
    if (value) data[field] = value;
  }
  return data;
}
