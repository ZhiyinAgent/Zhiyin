/** A delegated specialist's own run, drawn with the main history's own components. */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SpecialistRun, TaskAction } from "@zhiyin/contract";
import { SpecialistRunHistory } from "./SpecialistRunHistory.js";

const specialist = {
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews behavior and regressions.",
  instructions: "Inspect the evidence and report concrete risks.",
  provenance: { source: "plugin" as const, pluginId: "engineering" },
};

const ownAction: TaskAction = {
  id: "action-1",
  action: "Read file",
  target: "src/change.ts",
  command: "read_file(src/change.ts)",
  status: "completed",
};

describe("SpecialistRunHistory", () => {
  it("shows a running specialist without a handoff yet", () => {
    const run: SpecialistRun = {
      id: "specialist-1",
      specialist,
      task: "Review the proposed change.",
      depth: 1,
      status: "running",
      startedAt: "2026-09-17T00:00:00.000Z",
      actionIds: ["action-1"],
    };
    render(
      <SpecialistRunHistory
        run={run}
        actions={[
          ownAction,
          { ...ownAction, id: "action-2", target: "unrelated.ts" },
        ]}
      />,
    );

    expect(screen.getByText("Reviewer", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Review the proposed change.")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    // Only the specialist's own action is nested here, not the unrelated one.
    expect(screen.getByText("Read file")).toBeInTheDocument();
    expect(screen.queryByText("unrelated.ts")).toBeNull();
  });

  it("shows a completed specialist's structured handoff", () => {
    const run: SpecialistRun = {
      id: "specialist-1",
      specialist,
      task: "Review the proposed change.",
      depth: 1,
      status: "completed",
      startedAt: "2026-09-17T00:00:00.000Z",
      finishedAt: "2026-09-17T00:01:00.000Z",
      actionIds: ["action-1"],
      handoff: {
        summary: "The change is covered.",
        findings: ["A regression test exercises the behavior."],
        recommendations: ["Keep the test in the release gate."],
        limitations: [],
      },
    };
    render(<SpecialistRunHistory run={run} actions={[ownAction]} />);

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("The change is covered.")).toBeInTheDocument();
    expect(
      screen.getByText("A regression test exercises the behavior."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Keep the test in the release gate."),
    ).toBeInTheDocument();
  });

  it("shows why a specialist stopped without finishing", () => {
    const run: SpecialistRun = {
      id: "specialist-1",
      specialist,
      task: "Review the proposed change.",
      depth: 1,
      status: "interrupted",
      startedAt: "2026-09-17T00:00:00.000Z",
      finishedAt: "2026-09-17T00:01:00.000Z",
      actionIds: [],
      reason: "The specialist stopped before it completed.",
    };
    render(<SpecialistRunHistory run={run} actions={[]} />);

    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(
      screen.getByText("The specialist stopped before it completed."),
    ).toBeInTheDocument();
  });
});
