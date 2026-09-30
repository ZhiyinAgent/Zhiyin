/** A delegated specialist's own run, drawn with the main history's own components. */

import { fireEvent, render, screen, within } from "@testing-library/react";
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

const completed: SpecialistRun = {
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

function openDetails() {
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect Reviewer specialist" }),
  );
  return screen.getByRole("dialog");
}

describe("SpecialistRunHistory", () => {
  it("shows a running specialist as a short card naming its latest call, with every call kept in a modal", () => {
    const run: SpecialistRun = {
      id: "specialist-1",
      specialist,
      task: "Review the proposed change.",
      depth: 1,
      status: "running",
      startedAt: "2026-09-17T00:00:00.000Z",
      actionIds: [],
    };
    render(
      <SpecialistRunHistory
        run={run}
        actions={[
          { ...ownAction, specialistRunId: "specialist-1", sequence: 1 },
          {
            ...ownAction,
            id: "action-3",
            action: "Search the tests",
            specialistRunId: "specialist-1",
            sequence: 2,
          },
          { ...ownAction, id: "action-2", target: "unrelated.ts" },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Reviewer" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Review the proposed change.")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("2 calls")).toBeInTheDocument();
    // The card names what it is doing now, not every call it made.
    expect(screen.getByText("Search the tests")).toBeInTheDocument();
    expect(screen.queryByText("Read file")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    const dialog = openDetails();
    // Only the specialist's own action is listed, not the unrelated one.
    expect(within(dialog).getByText("Read file")).toBeInTheDocument();
    expect(within(dialog).queryByText("unrelated.ts")).toBeNull();
  });

  it("shows the first line of a completed specialist's report on the card, and the rest in the modal", () => {
    render(
      <SpecialistRunHistory
        run={{
          ...completed,
          handoff: {
            ...completed.handoff!,
            summary: "The change is covered.\nEvery branch has a test.",
          },
        }}
        actions={[ownAction]}
      />,
    );

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("The change is covered.")).toBeInTheDocument();
    expect(screen.queryByText(/Every branch has a test/)).toBeNull();
    expect(
      screen.queryByText("A regression test exercises the behavior."),
    ).toBeNull();

    const dialog = openDetails();
    expect(
      within(dialog).getByText(/Every branch has a test/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("A regression test exercises the behavior."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Keep the test in the release gate."),
    ).toBeInTheDocument();
    // The calls are one tab away from the report, not under it.
    expect(within(dialog).queryByText("Read file")).toBeNull();
    fireEvent.click(within(dialog).getByRole("tab", { name: /Calls/ }));
    expect(within(dialog).getByText("Read file")).toBeInTheDocument();
  });

  it("opens on the report once there is one, and on the calls until then", () => {
    const { unmount } = render(
      <SpecialistRunHistory run={completed} actions={[ownAction]} />,
    );
    let dialog = openDetails();
    expect(within(dialog).getByRole("tab", { name: "Report" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      within(dialog).getByRole("tab", { name: "Calls 1" }),
    ).toHaveAttribute("aria-selected", "false");
    unmount();

    render(
      <SpecialistRunHistory
        run={{
          id: completed.id,
          specialist,
          task: completed.task,
          depth: 1,
          status: "running",
          startedAt: completed.startedAt,
          actionIds: completed.actionIds,
        }}
        actions={[ownAction]}
      />,
    );
    dialog = openDetails();
    expect(
      within(dialog).getByRole("tab", { name: "Calls 1" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByText("Read file")).toBeInTheDocument();
  });

  it("heads each part of the report with how many items it has, and sets each item's lead apart", () => {
    render(
      <SpecialistRunHistory
        run={{
          ...completed,
          handoff: {
            summary: "Two problems.",
            findings: [
              "MAJOR (§11): the plan contradicts the required cadence.",
              "A finding with no lead, only a sentence.",
            ],
            recommendations: ["Rewrite §11 in two blocks."],
            limitations: [],
          },
        }}
        actions={[ownAction]}
      />,
    );
    const dialog = openDetails();

    expect(
      within(dialog).getByRole("heading", { name: "Findings 2" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: "Recommendations 1" }),
    ).toBeInTheDocument();
    // An empty part is left out rather than shown with nothing in it.
    expect(
      within(dialog).queryByRole("heading", { name: /Limitations/ }),
    ).toBeNull();
    const lead = within(dialog).getByText("MAJOR (§11)");
    expect(lead.tagName).toBe("STRONG");
    expect(lead.closest("li")).toHaveTextContent(
      "MAJOR (§11): the plan contradicts the required cadence.",
    );
    expect(
      within(dialog).getByText("A finding with no lead, only a sentence.")
        .tagName,
    ).not.toBe("STRONG");
  });

  it("shows why a specialist stopped without finishing, in the modal", () => {
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
    const dialog = openDetails();
    expect(
      within(dialog).getByText("The specialist stopped before it completed."),
    ).toBeInTheDocument();
  });

  it("closes with the Close button and with Escape", () => {
    render(<SpecialistRunHistory run={completed} actions={[ownAction]} />);

    openDetails();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    openDetails();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes only the call's own inspector when Escape is pressed above it", () => {
    render(<SpecialistRunHistory run={completed} actions={[ownAction]} />);

    const dialog = openDetails();
    fireEvent.click(within(dialog).getByRole("tab", { name: /Calls/ }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Inspect action" }),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(2);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      within(screen.getByRole("dialog")).getByText("Read file"),
    ).toBeInTheDocument();
  });
});
