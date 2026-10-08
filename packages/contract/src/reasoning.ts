export const REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type ReasoningSelection =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly effort?: ReasoningEffort };

export type ReasoningCapabilities =
  | {
      readonly status: "available";
      readonly required: boolean;
      readonly defaultEnabled: boolean;
      readonly defaultEffort?: ReasoningEffort;
      readonly efforts: readonly ReasoningEffort[];
    }
  | { readonly status: "unavailable"; readonly reason: string };

export type ReasoningTrace = {
  readonly text: string;
  readonly status: "streaming" | "complete" | "interrupted";
};
