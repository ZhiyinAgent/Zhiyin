/**
 * What the conversation's model is told of a settled specialist run: Zhiyin's
 * own words for which specialist ended and how, and the report and tool
 * timeline fenced after them as output another model wrote.
 */

import type { TaskAction } from "@zhiyin/contract";
import type { SpecialistExecutionResult } from "./specialist-execution.js";

/**
 * What Zhiyin says of a settled run: which specialist, and how it ended. The
 * report is not part of it: another model wrote that, after reading what it
 * was given, so it follows as output, data rather than instructions.
 */
function handoffHeader(result: SpecialistExecutionResult): string {
  const { name, id } = result.specialist;
  const reportFollows =
    "Its report follows as its own output: another model wrote it.";
  return result.ok
    ? `Specialist "${name}" (${id}) finished in the background. Run: ${result.runId}. ${reportFollows}`
    : `Specialist "${name}" (${id}) stopped before finishing. Run: ${result.runId}. Reason: ${result.reason} ${reportFollows}`;
}

/** The tool a handoff's report is fenced as the output of. */
export const handoffReportTool = "delegate_specialist";

function handoffTimeline(actions: readonly TaskAction[]) {
  return actions.map((action) => ({
    actionId: action.id,
    call: action.toolName ?? action.action,
    target: action.target,
    outcome: action.status,
    summary:
      action.reason ?? action.description ?? action.detail ?? action.status,
    details: `Recorded action ${action.id}`,
  }));
}

function handoffReport(result: SpecialistExecutionResult): string {
  return result.ok ? `Report:\n${result.handoff.report}\n\n` : "";
}

/** The whole report and timeline, as kept for read_file when too long. */
export function completeHandoffMessage(
  result: SpecialistExecutionResult,
  actions: readonly TaskAction[],
): string {
  const timeline = handoffTimeline(actions);
  return `${handoffReport(result)}Tool timeline (${timeline.length} calls, in order; recorded details are in the conversation):\n${timeline.map((line) => JSON.stringify(line)).join("\n")}`;
}

/** The handoff notice: Zhiyin's words, and the report fenced after them. */
export function handoffMessage(
  result: SpecialistExecutionResult,
  actions: readonly TaskAction[],
  savedOutput?: string,
): { readonly notice: string; readonly report: string } {
  const header = handoffHeader(result);
  const full = completeHandoffMessage(result, actions);
  if (full.length <= 12_000) return { notice: header, report: full };
  const report = handoffReport(result);
  const timeline = handoffTimeline(actions);
  const shown = timeline.slice(0, 10).map((line) => ({
    ...line,
    call: line.call.slice(0, 120),
    target: line.target.slice(0, 120),
    summary: line.summary.slice(0, 120),
  }));
  const omitted = timeline.length - shown.length;
  const excerpt = `${report.slice(0, 7_000)}${report.length > 7_000 ? "… [report continues in the saved output]\n" : ""}Tool timeline: ${timeline.length} calls; first ${shown.length}:\n${shown.map((line) => JSON.stringify(line)).join("\n")}\n${omitted} calls omitted from this notice.`;
  return {
    notice: savedOutput
      ? `${header}\nOnly an excerpt follows. Read the complete report and timeline from ${savedOutput}; its numbered pages show the rest.`
      : `${header}\nOnly an excerpt follows. The complete report and timeline remain in the specialist card, but the model could not retain a readable copy. Treat this handoff as incomplete.`,
    report: excerpt,
  };
}
