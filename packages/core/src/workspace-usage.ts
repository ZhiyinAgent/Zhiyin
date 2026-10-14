import type { AppEvent, UsageState } from "@zhiyin/contract";
import type { TurnHost } from "@zhiyin/agent-loop";
import type { UsageTelemetry } from "@zhiyin/usage";

/** Records one request's usage, and tells the window the new totals. */
export async function recordUsage(
  telemetry: UsageTelemetry,
  modelUsage: Parameters<TurnHost["recordUsage"]>[0],
  now: Date,
  emit: (event: AppEvent) => void,
): Promise<UsageState> {
  const usage = { ...modelUsage, recordedAt: now.toISOString() };
  const state: UsageState = await telemetry
    .record(usage)
    .then(() => telemetry.state(now))
    .catch(() => ({
      status: "failed",
      reason: "Usage history could not be saved.",
    }));
  emit({ kind: "usageChanged", data: state });
  return state;
}
