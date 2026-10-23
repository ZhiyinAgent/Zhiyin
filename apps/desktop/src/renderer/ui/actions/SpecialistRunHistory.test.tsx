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
  sequence: 1,
  id: "action-1",
  action: "Read file",
  target: "src/change.ts",
  command: "read_file(src/change.ts)",
  status: "completed",
};

const completed: SpecialistRun = {
  sequence: 1,
  id: "specialist-1",
  specialist,
  task: "Review the proposed change.",
  depth: 1,
  status: "completed",
  startedAt: "2026-09-17T00:00:00.000Z",
  finishedAt: "2026-09-17T00:01:00.000Z",
  actionIds: ["action-1"],
  handoff: {
    report: "The change is covered.",
  },
};

/**
 * The report as the window draws it is the conversation's Markdown, which the
 * app shell hands in; here it is kept as written, to show what reaches it.
 */
function Markdown({ children }: { children: string }) {
  return <pre>{children}</pre>;
}

function openDetails() {
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect Reviewer specialist" }),
  );
  return screen.getByRole("dialog");
}

describe("SpecialistRunHistory", () => {
  it("shows a running specialist as a short card led by its task, naming its latest call and what it is on, with every call kept in a modal", () => {
    const run: SpecialistRun = {
      sequence: 1,
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
        Markdown={Markdown}
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
    // Its task leads while it runs; under it, what it is doing now, on what,
    // and not every call it made.
    const card = screen.getByRole("region", { name: "Reviewer specialist" });
    expect(
      within(card)
        .getAllByRole("paragraph")
        .map((p) => p.textContent),
    ).toEqual([
      "Review the proposed change.",
      "Search the tests: src/change.ts",
    ]);
    expect(screen.queryByText(/Read file/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    const dialog = openDetails();
    // Only the specialist's own action is listed, not the unrelated one.
    expect(within(dialog).getByText("Read file")).toBeInTheDocument();
    expect(within(dialog).queryByText("unrelated.ts")).toBeNull();
  });

  it("shows the first line of a completed specialist's report on the card, and the rest in the modal", () => {
    render(
      <SpecialistRunHistory
        Markdown={Markdown}
        run={{
          ...completed,
          handoff: {
            report: [
              "The change is covered.",
              "Every branch has a test.",
              "",
              "## Findings",
              "",
              "- A regression test exercises the behavior.",
              "",
              "## Recommendations",
              "",
              "- Keep the test in the release gate.",
            ].join("\n"),
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
    ).toHaveTextContent(
      /A regression test exercises the behavior\.[\s\S]*Keep the test in the release gate\./,
    );
    // The calls are one tab away from the report, not under it.
    expect(within(dialog).queryByText("Read file")).toBeNull();
    fireEvent.click(within(dialog).getByRole("tab", { name: /Calls/ }));
    expect(within(dialog).getByText("Read file")).toBeInTheDocument();
  });

  it("shows a report that opens on a heading by its first words, without Markdown's marks", () => {
    render(
      <SpecialistRunHistory
        Markdown={Markdown}
        run={{
          ...completed,
          handoff: { report: "## Summary\n\n**All clear**: nothing to fix." },
        }}
        actions={[ownAction]}
      />,
    );

    expect(screen.getByText("All clear: nothing to fix.")).toBeInTheDocument();
  });

  it("opens on the report once there is one, and on the calls until then", () => {
    const { unmount } = render(
      <SpecialistRunHistory
        Markdown={Markdown}
        run={completed}
        actions={[ownAction]}
      />,
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
        Markdown={Markdown}
        run={{
          sequence: 1,
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

  it("moves between the report and the calls with the arrow keys, focus following", () => {
    render(
      <SpecialistRunHistory
        Markdown={Markdown}
        run={completed}
        actions={[ownAction]}
      />,
    );
    const dialog = openDetails();
    const report = within(dialog).getByRole("tab", { name: "Report" });
    const calls = within(dialog).getByRole("tab", { name: "Calls 1" });
    report.focus();

    fireEvent.keyDown(report, { key: "ArrowRight" });

    expect(document.activeElement).toBe(calls);
    expect(calls).toHaveAttribute("aria-selected", "true");
    expect(calls).toHaveAttribute("tabindex", "0");
    expect(report).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(calls, { key: "Home" });

    expect(document.activeElement).toBe(report);
    expect(report).toHaveAttribute("aria-selected", "true");
  });

  it("shows why a specialist stopped without finishing, in the modal", () => {
    const run: SpecialistRun = {
      sequence: 1,
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
    render(<SpecialistRunHistory Markdown={Markdown} run={run} actions={[]} />);

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
    render(
      <SpecialistRunHistory
        Markdown={Markdown}
        run={completed}
        actions={[ownAction]}
      />,
    );

    openDetails();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    openDetails();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes only the call's own inspector when Escape is pressed above it", () => {
    render(
      <SpecialistRunHistory
        Markdown={Markdown}
        run={completed}
        actions={[ownAction]}
      />,
    );

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
