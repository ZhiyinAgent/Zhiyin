import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { UndoChoices, type UndoChoice } from "./UndoChoices.js";
import { keyboardStops } from "./useModalFocus.js";

function Choices({
  files = true,
  memory = true,
}: {
  files?: boolean;
  memory?: boolean;
}) {
  const [choice, setChoice] = useState<UndoChoice>({
    files: true,
    memory: true,
  });
  return (
    <UndoChoices
      files={{ offered: files, detail: "Undoes 2 changes." }}
      memory={{ offered: memory, detail: "Takes back 1 entry." }}
      choice={choice}
      onChange={setChoice}
    />
  );
}

const box = (name: string) => screen.getByRole("checkbox", { name });

describe("choosing what to undo", () => {
  it("starts with everything ticked", () => {
    render(<Choices />);

    expect(box("Undo everything")).toBeChecked();
    expect(box("Undo file changes")).toBeChecked();
    expect(box("Undo memory changes")).toBeChecked();
    expect(box("Undo file changes")).toHaveAccessibleDescription(
      "Undoes 2 changes.",
    );
  });

  it("clears and ticks both kinds with the box for everything", () => {
    render(<Choices />);

    fireEvent.click(box("Undo everything"));
    expect(box("Undo file changes")).not.toBeChecked();
    expect(box("Undo memory changes")).not.toBeChecked();
    expect(box("Undo everything")).not.toBeChecked();

    fireEvent.click(box("Undo everything"));
    expect(box("Undo file changes")).toBeChecked();
    expect(box("Undo memory changes")).toBeChecked();
  });

  it("shows everything as mixed while one kind is ticked, and ticked again once both are", () => {
    render(<Choices />);

    fireEvent.click(box("Undo memory changes"));
    expect(box("Undo everything")).not.toBeChecked();
    expect(box("Undo everything")).toBePartiallyChecked();
    expect(box("Undo everything")).toHaveAttribute("aria-checked", "mixed");

    fireEvent.click(box("Undo memory changes"));
    expect(box("Undo everything")).toBeChecked();
    expect(box("Undo everything")).not.toBePartiallyChecked();
  });

  it("ticks both kinds when the mixed box is ticked", () => {
    render(<Choices />);
    fireEvent.click(box("Undo file changes"));

    fireEvent.click(box("Undo everything"));

    expect(box("Undo file changes")).toBeChecked();
    expect(box("Undo memory changes")).toBeChecked();
  });

  it("shows only the kind there is to undo, and no box for everything", () => {
    const { unmount } = render(<Choices memory={false} />);
    expect(screen.getAllByRole("checkbox")).toEqual([box("Undo file changes")]);
    unmount();

    render(<Choices files={false} />);
    expect(screen.getAllByRole("checkbox")).toEqual([
      box("Undo memory changes"),
    ]);
  });

  it("shows nothing when there is nothing to undo", () => {
    const { container } = render(<Choices files={false} memory={false} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("is reached by the keyboard in order, each a box Space ticks", () => {
    const { container } = render(<Choices />);

    expect(keyboardStops(container)).toEqual([
      box("Undo everything"),
      box("Undo file changes"),
      box("Undo memory changes"),
    ]);
    // Space on a focused box is the browser's click; jsdom does not make it.
    box("Undo file changes").focus();
    fireEvent.click(document.activeElement!);
    expect(box("Undo file changes")).not.toBeChecked();
    expect(box("Undo file changes")).toHaveFocus();
  });
});
