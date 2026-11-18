/**
 * Every feature a turn reaches, answering plainly and reaching nothing: what
 * the loop's own tests start from, and what the core's tests build on when
 * they run the loop inside the app. Exported as `@zhiyin/agent-loop/testing`.
 *
 * Each feature's fake is its owner's (ADR 0002); this joins them with what
 * the loop itself takes: ids, a clock, and where its events go.
 */

import { StandingGrantRules } from "@zhiyin/permission-engine";
import { fakePermissions } from "@zhiyin/permission-engine/testing";
import { fakeMembers } from "@zhiyin/capabilities/testing";
import { fakeKeptStore } from "@zhiyin/session/testing";
import { fakeModel } from "@zhiyin/model-client/testing";
import { fakeCorrectionsLog } from "@zhiyin/corrections-log/testing";
import { fakeArtifacts } from "@zhiyin/artifacts/testing";
import { fakeViews } from "@zhiyin/views/testing";
import { fakeRewindPlanner } from "@zhiyin/rewind-planner/testing";
import { fakeRecovery } from "@zhiyin/recovery/testing";
import type { AppEvent } from "@zhiyin/contract";
import type { CapabilityMembers } from "@zhiyin/capabilities";
import type { RewindPlanner } from "@zhiyin/rewind-planner";
import type { Recovery } from "@zhiyin/recovery";
import type { ModelEvent } from "@zhiyin/model-client";
import type { AgentLoopDependencies } from "../src/index.js";

export { jobsWith } from "@zhiyin/tools/testing";
export { pluginsOffering } from "@zhiyin/plugins/testing";

/**
 * The loop's dependencies with each group's members given separately, so a
 * test can replace one of them and still exercise the real joining.
 */
export type TurnStubs = Omit<
  AgentLoopDependencies,
  "capabilities" | "commands" | "rewind" | "backups" | "runs" | "host"
> &
  CapabilityMembers & {
    readonly rewind: RewindPlanner;
    readonly recovery: Recovery;
    readonly emit: (event: AppEvent) => void;
    readonly newTaskId: () => string;
  };

/**
 * Every feature the turn reaches, answering plainly and reaching nothing. There
 * is no 3D studio: a test that needs one adds its own.
 */
export function stubDependencies(
  emit: (event: AppEvent) => void,
  modelEvents: readonly ModelEvent[] = [{ kind: "done" }],
): Omit<TurnStubs, "scenes"> {
  let approvalNumber = 0;
  let taskNumber = 0;
  let messageNumber = 0;
  let actionNumber = 0;
  return {
    emit,
    permissions: fakePermissions(),
    // The grant rules as the application has them.
    grants: new StandingGrantRules(),
    ...fakeMembers(),
    kept: fakeKeptStore(),
    model: fakeModel(modelEvents),
    // The folder a conversation works in is the contract's to declare and
    // the loop's to take; no feature owns it.
    workspace: {
      describeWorkspace: async () => ({
        rootName: "workspace",
        entries: [],
        truncated: false,
      }),
      workspaceRoot: () => undefined,
    },
    corrections: fakeCorrectionsLog(),
    artifacts: fakeArtifacts(),
    views: fakeViews(),
    rewind: fakeRewindPlanner(),
    recovery: fakeRecovery(),
    guidanceModel: { send: fakeModel().send },
    newTaskId: () => `task-${++taskNumber}`,
    newMessageId: () => `message-${++messageNumber}`,
    newActionId: () => `${++actionNumber}`,
    newSpecialistRunId: () => `specialist-${++actionNumber}`,
    newApprovalId: () => `approval-${++approvalNumber}`,
    newUserInputId: () => `input-${++approvalNumber}`,
    now: () => new Date("2026-09-02T19:00:00.000Z"),
    // One zone whatever the machine running the tests is set to.
    timeZone: "UTC",
  };
}
