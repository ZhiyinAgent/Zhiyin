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
  | {
      readonly status: "unavailable";
      readonly reason: string;
      /**
       * The settings could not be looked up, so whether the model offers any
       * is not known. Absent when the model offers none.
       */
      readonly lookupFailed?: true;
    };

export type ReasoningTrace = {
  readonly text: string;
  readonly status: "streaming" | "complete" | "interrupted";
};
