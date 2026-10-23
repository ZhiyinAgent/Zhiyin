/**
 * The dialogs opened from an action are modal: while one is open, Tab and
 * Shift+Tab go round its own controls and never reach the page behind it.
 * Firing a key returns false when the dialog kept the browser from moving
 * focus on its own, which is what keeps it inside.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SpecialistRun, TaskAction } from "@zhiyin/contract";
import { ActionInspector } from "./ActionInspector.js";
import { DiffModal } from "./DiffModal.js";
import { SpecialistRunModal } from "./SpecialistRunModal.js";

const read: TaskAction = {
  id: "action-1",
  action: "Read a file",
  target: "notes.md",
  sequence: 1,
  status: "completed",
};

const run: SpecialistRun = {
  id: "run-1",
  specialist: {
    id: "research/reviewer",
    name: "Reviewer",
    description: "Reviews a draft.",
    instructions: "Review it.",
    provenance: { source: "plugin", pluginId: "research" },
  },
  task: "Review the brief.",
  depth: 1,
  status: "completed",
  startedAt: "2026-10-14T09:00:00.000Z",
  finishedAt: "2026-10-14T09:01:00.000Z",
  sequence: 2,
  actionIds: [],
  handoff: {
    report: "The brief reads well.",
  },
};

describe("a dialog opened from an action keeps the keyboard inside", () => {
  it("the account of what an action did", () => {
    render(<ActionInspector action={read} onClose={() => undefined} />);
    const dialog = screen.getByRole("dialog");

    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(
      false,
    );
    const last = document.activeElement as HTMLElement;
    expect(dialog).toContainElement(last);
    expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("the review of a change", () => {
    render(
      <DiffModal
        changes={[
          { path: "a.md", change: "updated", before: "a\n", after: "b\n" },
          { path: "b.md", change: "created", after: "c\n" },
        ]}
        onClose={() => undefined}
      />,
    );
    const dialog = screen.getByRole("dialog");

    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(
      false,
    );
    const last = document.activeElement as HTMLElement;
    expect(dialog).toContainElement(last);
    expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(last);
  });

  it("a specialist's run", () => {
    render(
      <SpecialistRunModal
        run={run}
        actions={[]}
        Markdown={({ children }) => <p>{children}</p>}
        onClose={() => undefined}
      />,
    );
    const dialog = screen.getByRole("dialog");

    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(
      false,
    );
    const last = document.activeElement as HTMLElement;
    expect(dialog).toContainElement(last);
    expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(last);
  });
});
