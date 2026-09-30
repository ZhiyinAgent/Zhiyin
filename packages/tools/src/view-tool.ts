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
  return trimmed && trimmed.length <= maximum ? trimmed : undefined;
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

export function correctable(reason: string): ToolCallInspection {
  return { ok: false, reason, correctable: true };
}

export function defineViewTool(
  spec: ToolSpec,
  action: string,
  kind: ViewKind,
  parse: (args: unknown) => { title: string; data: unknown } | string,
): ViewTool {
  async function inspect(args: unknown): Promise<ToolCallInspection> {
    const parsed = parse(args);
    if (typeof parsed === "string") return correctable(parsed);
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

export function chartLabels(
  item: Record<string, unknown>,
): Record<string, string> | string {
  const data: Record<string, string> = {};
  for (const field of ["xLabel", "yLabel", "unit"] as const) {
    const value = optionalText(item[field]);
    if (value === null)
      return `${field} must be non-empty text no longer than 120 characters.`;
    if (value) data[field] = value;
  }
  return data;
}
