/**
 * The part of the Agent Trajectory Interchange Format (ATIF) v1.8 the export
 * writes. Every object of the format refuses fields it does not name, so
 * anything of Zhiyin's own goes under `extra`.
 */

export const atifVersion = "ATIF-v1.8";

export type AtifContentPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly source: { readonly media_type: string; readonly path: string };
    };

type AtifContent = string | readonly AtifContentPart[];

export type AtifToolCall = {
  readonly tool_call_id: string;
  readonly function_name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly extra?: Readonly<Record<string, unknown>>;
};

export type AtifObservationResult = {
  readonly source_call_id?: string;
  readonly content?: AtifContent;
  readonly subagent_trajectory_ref?: readonly {
    readonly trajectory_id: string;
  }[];
  readonly extra?: Readonly<Record<string, unknown>>;
};

export type AtifMetrics = {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly cached_tokens?: number;
  readonly cost_usd?: number;
  readonly extra?: Readonly<Record<string, unknown>>;
};

export type AtifStep = {
  readonly step_id: number;
  readonly timestamp?: string;
  readonly source: "system" | "user" | "agent";
  readonly model_name?: string;
  readonly message: AtifContent;
  readonly reasoning_content?: string;
  readonly tool_calls?: readonly AtifToolCall[];
  readonly observation?: { readonly results: AtifObservationResult[] };
  readonly metrics?: AtifMetrics;
  readonly llm_call_count?: number;
  readonly extra?: Readonly<Record<string, unknown>>;
};

export type AtifFinalMetrics = {
  readonly total_prompt_tokens: number;
  readonly total_completion_tokens: number;
  readonly total_cached_tokens: number;
  readonly total_cost_usd?: number;
  readonly total_steps: number;
  readonly extra?: Readonly<Record<string, unknown>>;
};

export type AtifTrajectory = {
  readonly schema_version: typeof atifVersion;
  readonly session_id?: string;
  readonly trajectory_id?: string;
  readonly agent: {
    readonly name: string;
    readonly version: string;
    readonly model_name?: string;
    readonly extra?: Readonly<Record<string, unknown>>;
  };
  readonly steps: readonly AtifStep[];
  readonly notes?: string;
  readonly final_metrics?: AtifFinalMetrics;
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly subagent_trajectories?: readonly AtifTrajectory[];
};
