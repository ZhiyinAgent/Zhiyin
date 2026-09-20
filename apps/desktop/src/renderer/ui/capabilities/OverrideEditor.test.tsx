import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentContent } from "@zhiyin/contract";
import { OverrideEditor } from "./OverrideEditor.js";

const shippedSpecialist: ComponentContent = {
  id: "engineering/code-reviewer",
  kind: "specialist",
  name: "Code reviewer",
  description: "Reviews a change.",
  instructions: "Check for regressions.",
  editing: "override",
};

const editedSkill: ComponentContent = {
  id: "engineering/test-driven-development",
  kind: "skill",
  name: "test-driven-development",
  description: "Mine.",
  instructions: "My own instructions.",
  editing: "override",
  shipped: {
    name: "test-driven-development",
    description: "Use when changing behavior.",
    instructions: "Write the failing test first.",
  },
  shippedChanged: true,
};

describe("OverrideEditor", () => {
  it("edits a specialist's name, description, and instructions, requiring each", async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <OverrideEditor
        content={shippedSpecialist}
        onSave={onSave}
        onReset={async () => undefined}
        onClose={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter a name.")).toBeVisible();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Strict reviewer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        name: "Strict reviewer",
        description: "Reviews a change.",
        instructions: "Check for regressions.",
      }),
    );
    // Nothing to reset until there is an edit.
    expect(
      screen.queryByRole("button", { name: "Reset to shipped version" }),
    ).not.toBeInTheDocument();
  });

  it("shows a skill's name as fixed, since it is the skill's id", () => {
    render(
      <OverrideEditor
        content={editedSkill}
        onSave={async () => undefined}
        onReset={async () => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByText("test-driven-development")).toBeVisible();
  });

  it("says the plugin ships a different version now, and shows it on request", () => {
    render(
      <OverrideEditor
        content={editedSkill}
        onSave={async () => undefined}
        onReset={async () => undefined}
        onClose={() => undefined}
      />,
    );

    expect(
      screen.getByText(/now ships a different version than the one you edited/),
    ).toBeVisible();
    expect(
      screen.queryByText("Write the failing test first."),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show shipped version" }),
    );
    expect(screen.getByText("Write the failing test first.")).toBeVisible();
  });

  it("confirms before discarding an edit for the shipped version", async () => {
    const onReset = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(
      <OverrideEditor
        content={editedSkill}
        onSave={async () => undefined}
        onReset={onReset}
        onClose={onClose}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Reset to shipped version" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "Discard your edit and use the shipped version?",
      ),
    ).toBeVisible();
    expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Use shipped version" }),
    );

    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the dialog open and says so when saving fails", async () => {
    const onClose = vi.fn();
    render(
      <OverrideEditor
        content={editedSkill}
        onSave={async () => {
          throw new Error("unavailable");
        }}
        onReset={async () => undefined}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Could not save this skill.")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });
});
