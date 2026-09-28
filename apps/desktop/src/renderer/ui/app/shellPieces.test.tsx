/** The shell's own pieces: the folder picker, the sidebar, the header. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspacePicker } from "./WorkspacePicker.js";
import { AppSidebar } from "./AppSidebar.js";
import { SessionHeader } from "./SessionHeader.js";

describe("WorkspacePicker", () => {
  const current = { path: "C:/work/reports", name: "reports" };
  const recent = [
    current,
    { path: "C:/work/notes", name: "notes" },
    { path: "C:/work/site", name: "site" },
  ];

  it("names the current folder without opening anything", () => {
    render(
      <WorkspacePicker
        current={current}
        recent={recent}
        onChoose={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", { name: /^Workspace folder/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers the other folders worked in, and the file dialog after them", () => {
    const onUseRecent = vi.fn();
    render(
      <WorkspacePicker
        current={current}
        recent={recent}
        onUseRecent={onUseRecent}
        onChoose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Workspace folder/ }));
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

  it("closes when the person clicks away, or the window loses focus", () => {
    render(<WorkspacePicker recent={[]} onChoose={() => undefined} />);
    const trigger = screen.getByRole("button", { name: /^Workspace folder/ });

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.blur(window);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("says a folder has not been chosen yet rather than naming a default", () => {
    render(<WorkspacePicker recent={[]} onChoose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /^Workspace folder/ }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");

    expect(items.map((item) => item.textContent)).toEqual(["Choose a folder…"]);
  });

  /**
   * The composer dock scrolls its own content, so an absolutely positioned
   * menu is clipped by it — the menu was cut off at the top when it first
   * shipped. It is positioned against the viewport instead, which means the
   * component, not the stylesheet, supplies the offsets.
   */
  it("positions the menu against the viewport rather than its parent", () => {
    render(
      <WorkspacePicker
        current={current}
        recent={recent}
        onChoose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Workspace folder/ }));
    const menu = screen.getByRole("menu");

    expect(menu.style.left).not.toBe("");
    expect(menu.style.top || menu.style.bottom).not.toBe("");
    expect(menu.style.maxHeight).not.toBe("");
  });

  it("closes on Escape without changing the folder", () => {
    const onUseRecent = vi.fn();
    render(
      <WorkspacePicker
        current={current}
        recent={recent}
        onUseRecent={onUseRecent}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Workspace folder/ }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onUseRecent).not.toHaveBeenCalled();
  });

  /** Changing the folder mid-task would move the ground under a running one. */
  it("cannot be opened while a task is running", () => {
    render(
      <WorkspacePicker
        current={current}
        recent={recent}
        disabled
        onChoose={() => undefined}
      />,
    );

    const trigger = screen.getByRole("button", { name: /^Workspace folder/ });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("AppSidebar", () => {
  it("identifies the current task and selects another task", () => {
    const onSelect = vi.fn();
    render(
      <AppSidebar
        selectedId="release"
        onSelect={onSelect}
        tasks={[
          { id: "release", title: "Prepare v0.1 release notes", meta: "Now" },
          { id: "audit", title: "Audit dependencies", meta: "Yesterday" },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /prepare v0\.1 release notes/i }),
    ).toHaveAttribute("aria-current", "page");
    fireEvent.click(
      screen.getByRole("button", { name: /audit dependencies/i }),
    );
    expect(onSelect).toHaveBeenCalledWith("audit");
  });

  it("shows relative conversation age from timestamps instead of a frozen label", () => {
    render(
      <AppSidebar
        selectedId="recent"
        onSelect={() => undefined}
        now={() => new Date("2026-09-04T12:00:00.000Z")}
        tasks={[
          {
            id: "recent",
            title: "Recent work",
            updatedAt: "2026-09-04T11:56:00.000Z",
          },
          {
            id: "older",
            title: "Older work",
            updatedAt: "2026-09-02T08:00:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByText("4m")).toBeVisible();
    expect(screen.getByText("2d")).toBeVisible();
    expect(screen.queryByText("Now")).toBeNull();
  });

  it("keeps management navigation direct and free of decorative metadata", () => {
    const onOpenAgents = vi.fn();
    const onOpenSkills = vi.fn();
    const onOpenUsage = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        onOpenAgents={onOpenAgents}
        onOpenSkills={onOpenSkills}
        onOpenUsage={onOpenUsage}
        onOpenSettings={onOpenSettings}
        tasks={[{ id: "release", title: "Prepare release notes", meta: "Now" }]}
      />,
    );

    expect(screen.getByText("ZHIYIN")).toBeInTheDocument();
    expect(screen.queryByText("Ctrl N")).toBeNull();
    expect(screen.queryByText(/ready/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Task list options" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(onOpenSkills).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(onOpenAgents).toHaveBeenCalledOnce();

    // One menu, on the preferences row. The brand row carried a second copy of
    // it, which is a second place to look for the same two things.
    expect(within(screen.getByRole("banner")).queryByRole("button")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open app menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Usage" }));
    expect(onOpenUsage).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Open app menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("closes the app menu, a conversation's menu and its delete question when the person clicks away, or the window loses focus", () => {
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        onOpenSettings={() => undefined}
        tasks={[{ id: "release", title: "Prepare release notes", meta: "Now" }]}
      />,
    );
    const row = screen.getByRole("button", { name: /prepare release notes/i });

    fireEvent.click(screen.getByRole("button", { name: "Open app menu" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open app menu" }));
    fireEvent.blur(window);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(row);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.blur(window);
    expect(
      screen.queryByRole("group", { name: "Delete Prepare release notes" }),
    ).toBeNull();
  });

  it("lets a click on the window's top bar reach the app while a menu is open", () => {
    render(
      <AppSidebar
        selectedId=""
        onSelect={() => undefined}
        onOpenSettings={() => undefined}
        tasks={[]}
      />,
    );

    expect(document.documentElement).not.toHaveAttribute("data-layer-open");
    fireEvent.click(screen.getByRole("button", { name: "Open app menu" }));
    expect(document.documentElement).toHaveAttribute("data-layer-open");
    fireEvent.pointerDown(document.body);
    expect(document.documentElement).not.toHaveAttribute("data-layer-open");
  });

  it("renames a conversation in place from its context menu", () => {
    const onRenameTask = vi.fn();
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        onRenameTask={onRenameTask}
        tasks={[{ id: "release", title: "Prepare release notes", meta: "Now" }]}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /prepare release notes/i }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox", {
      name: "Rename conversation",
    });
    expect(input).toHaveValue("Prepare release notes");
    fireEvent.change(input, { target: { value: "Publish release notes" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRenameTask).toHaveBeenCalledWith(
      "release",
      "Publish release notes",
    );
    expect(onRenameTask).toHaveBeenCalledOnce();
  });

  it("places a conversation menu above a low row without enlarging the list", () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 760,
    });
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        tasks={[{ id: "release", title: "Prepare release notes", meta: "Now" }]}
      />,
    );

    const row = screen.getByRole("button", { name: /prepare release notes/i });
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      x: 11,
      y: 710,
      top: 710,
      right: 211,
      bottom: 749,
      left: 11,
      width: 200,
      height: 39,
      toJSON: () => ({}),
    });

    fireEvent.contextMenu(row);

    expect(screen.getByRole("menu")).toHaveStyle({
      position: "fixed",
      top: "594px",
    });
  });

  it("confirms deletion beside the conversation instead of opening a dialog", () => {
    const onDeleteTask = vi.fn();
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        onDeleteTask={onDeleteTask}
        tasks={[{ id: "release", title: "Prepare release notes", meta: "Now" }]}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /prepare release notes/i }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("group", { name: "Delete Prepare release notes" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete conversation" }),
    );
    expect(onDeleteTask).toHaveBeenCalledWith("release");
  });
});

describe("SessionHeader", () => {
  it("keeps transient task controls out of the header", () => {
    render(
      <SessionHeader
        workspace="Zhiyin Desktop"
        title="Prepare v0.1 release notes"
      />,
    );

    expect(screen.getByText("Prepare v0.1 release notes")).toBeInTheDocument();
    expect(screen.queryByText(/live/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Task options" })).toBeNull();
  });
});
