/** The folder picker in the composer. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FolderPicker } from "./FolderPicker.js";

describe("FolderPicker", () => {
  it("opens on the folder in use, and moves through the folders with the arrow keys", () => {
    render(
      <FolderPicker
        current={{ path: "C:/Users/sam/Work/notes", name: "notes" }}
        recent={[
          { path: "C:/Users/sam/Work/notes", name: "notes" },
          { path: "C:/Users/sam/quarterly-reports", name: "quarterly-reports" },
        ]}
        onUseRecent={() => undefined}
        onChoose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Folder:/ }));
    const menu = screen.getByRole("menu");
    const [inUse, other, choose] = within(menu).getAllByRole("menuitem");
    expect(document.activeElement).toBe(inUse);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(other);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(choose);
  });

  it("tells two folders with the same name apart by the folder they are in", () => {
    render(
      <FolderPicker
        current={{ path: "C:/Users/sam/Work/notes", name: "notes" }}
        recent={[
          { path: "C:/Users/sam/Work/notes", name: "notes" },
          { path: "D:/Archive/2025/notes", name: "notes" },
          { path: "C:/Users/sam/quarterly-reports", name: "quarterly-reports" },
        ]}
        onUseRecent={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Folder:/ }));

    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveTextContent("notesC:/Users/sam/Work");
    expect(items[1]).toHaveTextContent("notesD:/Archive/2025");
    expect(items[2]).toHaveTextContent(/^quarterly-reports$/);
  });

  const current = { path: "C:/work/reports", name: "reports" };
  const recent = [
    current,
    { path: "C:/work/notes", name: "notes" },
    { path: "C:/work/site", name: "site" },
  ];

  it("names the current folder without opening anything", () => {
    render(
      <FolderPicker
        current={current}
        recent={recent}
        onChoose={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: /^Folder:/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers the other folders worked in, and the file dialog after them", () => {
    const onUseRecent = vi.fn();
    render(
      <FolderPicker
        current={current}
        recent={recent}
        onUseRecent={onUseRecent}
        onChoose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Folder:/ }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");

    expect(items.map((item) => item.textContent)).toEqual([
      "reports",
      "notes",
      "site",
      "Choose another folder…",
    ]);

    fireEvent.click(screen.getByRole("menuitem", { name: "notes" }));
    expect(onUseRecent).toHaveBeenCalledWith("C:/work/notes");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it.each(["notes", "Choose another folder…"])(
    "puts focus back on the picker once %s is chosen",
    (item) => {
      render(
        <FolderPicker
          current={current}
          recent={recent}
          onUseRecent={() => undefined}
          onChoose={() => undefined}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /^Folder:/ }));
      const chosen = screen.getByRole("menuitem", { name: item });
      chosen.focus();
      fireEvent.click(chosen);

      expect(screen.getByRole("button", { name: /^Folder:/ })).toHaveFocus();
    },
  );

  it("closes when the person clicks away, or the window loses focus", () => {
    render(<FolderPicker recent={[]} onChoose={() => undefined} />);
    const trigger = screen.getByRole("button", { name: /^Folder:/ });

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.blur(window);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("says a folder has not been chosen yet rather than naming a default", () => {
    render(<FolderPicker recent={[]} onChoose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /^Folder:/ }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");

    expect(items.map((item) => item.textContent)).toEqual(["Choose a folder…"]);
  });

  /**
   * The composer dock scrolls its own content, so an absolutely positioned
   * menu would be cut off at its top. It is positioned against the viewport
   * instead, which means the component, not the stylesheet, supplies the
   * offsets.
   */
  it("positions the menu against the viewport rather than its parent", () => {
    render(
      <FolderPicker
        current={current}
        recent={recent}
        onChoose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Folder:/ }));
    const menu = screen.getByRole("menu");

    expect(menu.style.left).not.toBe("");
    expect(menu.style.top || menu.style.bottom).not.toBe("");
    expect(menu.style.maxHeight).not.toBe("");
  });

  it("closes on Escape without changing the folder", () => {
    const onUseRecent = vi.fn();
    render(
      <FolderPicker
        current={current}
        recent={recent}
        onUseRecent={onUseRecent}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Folder:/ }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onUseRecent).not.toHaveBeenCalled();
  });

  /** Changing the folder mid-task would move the ground under a running one. */
  it("cannot be opened while a task is running", () => {
    render(
      <FolderPicker
        current={current}
        recent={recent}
        disabled
        onChoose={() => undefined}
      />,
    );

    const trigger = screen.getByRole("button", { name: /^Folder:/ });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape inside the menu, with focus back on its button", () => {
    render(
      <FolderPicker
        current={current}
        recent={recent}
        onUseRecent={() => undefined}
      />,
    );
    const button = screen.getByRole("button", { name: /^Folder:/ });
    fireEvent.click(button);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("unrolls from where it opens", () => {
    render(<FolderPicker current={current} recent={recent} />);
    fireEvent.click(screen.getByRole("button", { name: /^Folder:/ }));

    expect(screen.getByRole("menu")).toHaveAttribute(
      "data-opens",
      expect.stringMatching(/^(up|down)$/),
    );
  });
});
