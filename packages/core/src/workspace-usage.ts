import type { AppEvent, UsageState } from "@zhiyin/contract";
import type { TurnHost } from "@zhiyin/agent-loop";
import type { UsageTelemetry } from "@zhiyin/usage";

export async function recordUsage(
  telemetry: UsageTelemetry,
  modelUsage: Parameters<TurnHost["recordUsage"]>[0],
  now: Date,
  emit: (event: AppEvent) => void,
): Promise<UsageState> {
  const usage = { ...modelUsage, recordedAt: now.toISOString() };
  emit({ kind: "usageRecorded", data: usage });
  try {
    await telemetry.record(usage);
    return await telemetry.state(now);
  } catch {
    return {
      status: "unavailable",
      reason: "Usage history could not be saved.",
    };
  }
}
