/** The sidebar: its conversations, projects and menus. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar.js";

describe("AppSidebar", () => {
  it("identifies the current task and selects another task", () => {
    const onSelect = vi.fn();
    render(
      <AppSidebar
        selectedId="release"
        onSelect={onSelect}
        tasks={[
          { id: "release", title: "Prepare v0.1 release notes" },
          { id: "audit", title: "Audit dependencies" },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: /^prepare v0\.1 release notes/i }),
    ).toHaveAttribute("aria-current", "page");
    fireEvent.click(
      screen.getByRole("button", { name: /^audit dependencies/i }),
    );
    expect(onSelect).toHaveBeenCalledWith("audit");
  });

  it("writes no age beside a conversation, and says when it last changed over its row", () => {
    const changed = "2026-08-20T12:00:00.000Z";
    render(
      <AppSidebar
        selectedId=""
        onSelect={() => undefined}
        tasks={[
          { id: "dated", title: "Dated work", updatedAt: changed },
          { id: "undated", title: "Undated work" },
        ]}
      />,
    );

    const dated = screen.getByRole("button", { name: "Dated work" });
    expect(dated).toHaveAttribute(
      "title",
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(changed)),
    );
    expect(dated).toHaveTextContent(/^Dated work$/);
    expect(
      screen.getByRole("button", { name: "Undated work" }),
    ).not.toHaveAttribute("title");
  });

  it("says a conversation is waiting for an update on its row", () => {
    render(
      <AppSidebar
        selectedId=""
        onSelect={() => undefined}
        tasks={[{ id: "old", title: "Old work", needsUpdate: true }]}
      />,
    );

    expect(screen.getByText("To update")).toBeVisible();
  });

  it("keeps management navigation direct and free of decorative metadata", () => {
    const onOpenLibrary = vi.fn();
    const onOpenUsage = vi.fn();
    const onOpenModel = vi.fn();
    const onOpenMemory = vi.fn();
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        onOpenLibrary={onOpenLibrary}
        onOpenUsage={onOpenUsage}
        onOpenModel={onOpenModel}
        onOpenMemory={onOpenMemory}
        tasks={[{ id: "release", title: "Prepare release notes" }]}
      />,
    );

    expect(screen.getByText("ZHIYIN")).toBeInTheDocument();
    expect(screen.queryByText("Ctrl N")).toBeNull();
    expect(screen.queryByText(/ready/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Task list options" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Skills" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(onOpenLibrary).toHaveBeenCalledOnce();

    // The brand row holds no button: the app's pages are in the
    // navigation and its foot, in one place each.
    expect(within(screen.getByRole("banner")).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open app menu" })).toBeNull();

    const app = screen.getByRole("navigation", { name: "App" });
    fireEvent.click(within(app).getByRole("button", { name: "Memory" }));
    expect(onOpenMemory).toHaveBeenCalledOnce();

    const foot = screen.getByRole("navigation", { name: "Zhiyin" });
    fireEvent.click(within(foot).getByRole("button", { name: "Usage" }));
    expect(onOpenUsage).toHaveBeenCalledOnce();
    fireEvent.click(within(foot).getByRole("button", { name: /^Model/ }));
    expect(onOpenModel).toHaveBeenCalledOnce();
  });

  it("names the model in use at its foot, and says when none is chosen", () => {
    const onOpenSettings = vi.fn();
    const { rerender } = render(
      <AppSidebar
        selectedId=""
        onSelect={() => undefined}
        onOpenSettings={onOpenSettings}
        modelName="Claude Sonnet 5"
        tasks={[]}
      />,
    );
    const foot = () => screen.getByRole("navigation", { name: "Zhiyin" });

    const model = within(foot()).getByRole("button", {
      name: "Model: Claude Sonnet 5",
    });
    expect(model).toHaveTextContent("Claude Sonnet 5");
    expect(model).toHaveAttribute("data-tip", "Model: Claude Sonnet 5");
    for (const page of ["Usage", "Settings"])
      expect(
        within(foot()).getByRole("button", { name: page }),
      ).toHaveAttribute("data-tip", page);
    fireEvent.click(within(foot()).getByRole("button", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();

    rerender(
      <AppSidebar
        selectedId=""
        onSelect={() => undefined}
        onOpenSettings={onOpenSettings}
        tasks={[]}
      />,
    );
    expect(
      within(foot()).getByRole("button", { name: "Model: none chosen" }),
    ).toHaveTextContent("Choose a model");
  });

  it("moves through a conversation's menu with the arrow keys, starting on its first item", () => {
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        onOpenModel={() => undefined}
        tasks={[{ id: "release", title: "Prepare release notes" }]}
      />,
    );
    const focused = () => document.activeElement?.textContent;

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /^prepare release notes/i }),
    );
    const taskMenu = screen.getByRole("menu");
    expect(focused()).toBe("Rename");
    fireEvent.keyDown(taskMenu, { key: "ArrowDown" });
    expect(focused()).toBe("Permissions");
    fireEvent.keyDown(taskMenu, { key: "ArrowUp" });
    fireEvent.keyDown(taskMenu, { key: "ArrowUp" });
    expect(focused()).toBe("Delete");
  });

  it("closes a conversation's menu and its delete question when the person clicks away, or the window loses focus", () => {
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        onOpenModel={() => undefined}
        tasks={[{ id: "release", title: "Prepare release notes" }]}
      />,
    );
    const row = screen.getByRole("button", { name: /^prepare release notes/i });

    fireEvent.contextMenu(row);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(row);
    fireEvent.blur(window);
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
        onOpenModel={() => undefined}
        tasks={[{ id: "release", title: "Prepare release notes" }]}
      />,
    );

    expect(document.documentElement).not.toHaveAttribute("data-layer-open");
    fireEvent.click(
      screen.getByRole("button", { name: "Options for Prepare release notes" }),
    );
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
        tasks={[{ id: "release", title: "Prepare release notes" }]}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /^prepare release notes/i }),
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

  it("offers one Export item in a conversation's menu, which asks how to export it", () => {
    const onExportConversation = vi.fn();
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        onExportConversation={onExportConversation}
        tasks={[{ id: "release", title: "Prepare release notes" }]}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /^prepare release notes/i }),
    );
    expect(screen.getAllByRole("menuitem", { name: /Export/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Export…" }));

    expect(onExportConversation).toHaveBeenCalledWith("release");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers no export where the app cannot export", () => {
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        tasks={[{ id: "release", title: "Prepare release notes" }]}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /^prepare release notes/i }),
    );

    expect(screen.queryByRole("menuitem", { name: /Export/ })).toBeNull();
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
        tasks={[{ id: "release", title: "Prepare release notes" }]}
      />,
    );

    const row = screen.getByRole("button", { name: /^prepare release notes/i });
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

    // Its bottom edge 4px above the row's top (760 - 710 + 4), however tall
    // the menu turns out to be.
    expect(screen.getByRole("menu")).toHaveStyle({
      position: "fixed",
      bottom: "54px",
    });
  });

  it("opens a conversation's menu from its own options button, not only by right-click", () => {
    const onRenameTask = vi.fn();
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        onRenameTask={onRenameTask}
        tasks={[
          { id: "release", title: "Prepare release notes" },
          { id: "audit", title: "Audit dependencies" },
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Options for Audit dependencies" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    expect(
      screen.getByRole("textbox", { name: "Rename conversation" }),
    ).toHaveValue("Audit dependencies");
  });

  it("names the conversation it is about to delete", () => {
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        onDeleteTask={() => undefined}
        tasks={[{ id: "release", title: "Prepare release notes" }]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Options for Prepare release notes" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(
      screen.getByRole("group", { name: "Delete Prepare release notes" }),
    ).toHaveTextContent("Delete “Prepare release notes”?");
  });

  it("confirms deletion beside the conversation instead of opening a dialog", () => {
    const onDeleteTask = vi.fn();
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        onDeleteTask={onDeleteTask}
        tasks={[{ id: "release", title: "Prepare release notes" }]}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: /^prepare release notes/i }),
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

  it("unrolls a conversation's menu from its row", () => {
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        tasks={[{ id: "release", title: "Prepare release notes" }]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Options for Prepare release notes" }),
    );
    expect(screen.getByRole("menu")).toHaveAttribute(
      "data-opens",
      expect.stringMatching(/^(up|down)$/),
    );
  });

  it("gives focus back to the options button when Escape closes a conversation's menu", () => {
    render(
      <AppSidebar
        selectedId="release"
        onSelect={() => undefined}
        tasks={[{ id: "release", title: "Prepare release notes" }]}
      />,
    );
    const options = screen.getByRole("button", {
      name: "Options for Prepare release notes",
    });
    fireEvent.click(options);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(options).toHaveFocus();
  });
});

describe("AppSidebar with projects", () => {
  const at = (day: number) =>
    `2026-10-${String(day).padStart(2, "0")}T09:00:00.000Z`;
  const projects = [
    { id: "kitchen", name: "Kitchen renovation" },
    { id: "thesis", name: "Thesis" },
    { id: "club", name: "Running club newsletter" },
  ];
  const tasks = [
    {
      id: "ch3",
      title: "Chapter 3 proofreading",
      updatedAt: at(30),
      projectId: "thesis",
    },
    {
      id: "quotes",
      title: "Kitchen quotes",
      updatedAt: at(26),
      projectId: "kitchen",
    },
    { id: "card", title: "Birthday card", updatedAt: at(29) },
    {
      id: "data",
      title: "Cleaning the 2025 data",
      updatedAt: at(28),
      projectId: "thesis",
    },
  ];

  function draw(props: Partial<Parameters<typeof AppSidebar>[0]> = {}): void {
    render(
      <AppSidebar
        selectedId="ch3"
        onSelect={() => undefined}
        tasks={tasks}
        projects={projects}
        {...props}
      />,
    );
  }

  it("lists projects above recent conversations, each project's conversations under it and not in Recent", () => {
    draw();

    const projectList = screen.getByRole("list", { name: "Projects" });
    const recent = screen.getByRole("list", { name: "Recent" });
    expect(
      within(projectList).getByRole("button", { name: /^Thesis/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      within(projectList).getByRole("button", {
        name: /^Chapter 3 proofreading/,
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(recent).getByRole("button", { name: /^Birthday card/ }),
    ).toBeVisible();
    expect(within(recent).queryByText("Chapter 3 proofreading")).toBeNull();
    expect(within(recent).queryByText("Kitchen quotes")).toBeNull();
  });

  it("opens the project holding the current conversation, and opens or closes the others on their row", () => {
    draw();

    const kitchen = screen.getByRole("button", { name: /^Kitchen renovation/ });
    expect(kitchen).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Kitchen quotes")).toBeNull();

    fireEvent.click(kitchen);
    expect(kitchen).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Kitchen quotes")).toBeVisible();

    fireEvent.click(kitchen);
    expect(screen.queryByText("Kitchen quotes")).toBeNull();
  });

  it("orders projects by their latest conversation, and says how many a closed one holds", () => {
    draw();

    // In the order they are drawn.
    const names = screen
      .getAllByRole("button", {
        name: /^(Thesis|Kitchen renovation|Running club newsletter)/,
      })
      .map((button) => button.querySelector("span")?.textContent);
    expect(names).toEqual([
      "Thesis",
      "Kitchen renovation",
      "Running club newsletter",
    ]);
    expect(
      screen.getByRole("button", { name: /^Kitchen renovation/ }),
    ).toHaveTextContent("1");
  });

  it("shows a project's five latest conversations, then the rest on request", () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      id: `t${index}`,
      title: `Thesis task ${index + 1}`,
      updatedAt: at(30 - index),
      projectId: "thesis",
    }));
    draw({ tasks: many, selectedId: "t0" });

    expect(screen.getByText("Thesis task 5")).toBeVisible();
    expect(screen.queryByText("Thesis task 6")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getByText("Thesis task 7")).toBeVisible();
  });

  it("starts a conversation in a project from its row, and says when a project has none yet", () => {
    const onNewTaskInProject = vi.fn();
    draw({ onNewTaskInProject });

    fireEvent.click(
      screen.getByRole("button", {
        name: "New conversation in Running club newsletter",
      }),
    );
    expect(onNewTaskInProject).toHaveBeenCalledWith("club");

    fireEvent.click(
      screen.getByRole("button", { name: /^Running club newsletter/ }),
    );
    expect(screen.getByText("No conversations yet")).toBeVisible();
  });

  it("keeps the single Recent list when there are no projects", () => {
    draw({ projects: [] });

    expect(screen.queryByRole("list", { name: "Projects" })).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "Recent" })).getByText(
        "Chapter 3 proofreading",
      ),
    ).toBeVisible();
  });
});
