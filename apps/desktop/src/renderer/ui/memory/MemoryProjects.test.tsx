/** Projects as the Memory page manages them (ADR 0026). */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  memoryLimits,
  type MemoryOutcome,
  type MemoryProject,
  type MemoryRequest,
  type MemoryState,
} from "@zhiyin/contract";
import { MemoryPage } from "./MemoryPage.js";

const created = "2026-09-20T09:00:00.000Z";
const thesis: MemoryProject = {
  id: "thesis",
  name: "Thesis",
  folders: ["C:\\Users\\Lea\\Thesis"],
  created,
};
const kitchen: MemoryProject = {
  id: "kitchen",
  name: "Kitchen",
  folders: [],
  created,
};
const old: MemoryProject = {
  id: "old",
  name: "Old paper",
  folders: [],
  created,
  archived: true,
};

const memory: MemoryState = {
  on: true,
  projects: [thesis, kitchen, old],
  entries: [
    {
      number: 12,
      scope: "thesis",
      section: "knowledge",
      title: "Typst over LaTeX",
      summary: "The template needs a grid",
      text: "Chosen on 3 October.",
      written: created,
    },
  ],
  waiting: [],
  limits: memoryLimits,
  broadFolders: [],
};

function page(answer: MemoryOutcome = { ok: true }) {
  const onChange = vi.fn<(request: MemoryRequest) => Promise<MemoryOutcome>>(
    async () => answer,
  );
  const view = render(
    <MemoryPage memory={memory} onChange={onChange} onClose={() => {}} />,
  );
  return { onChange, view };
}

const scopes = () => screen.getByRole("navigation", { name: "Scopes" });
const choose = (name: string) =>
  fireEvent.click(
    within(scopes()).getByRole("button", { name: new RegExp(`^${name}`) }),
  );
const project = () => screen.getByRole("region", { name: "Project" });

describe("projects on the Memory page", () => {
  it("makes a project by its name, and opens it once memory holds it", async () => {
    const made: MemoryProject = {
      id: "garden",
      name: "Garden",
      folders: [],
      created,
    };
    const { onChange, view } = page({ ok: true, project: made });

    fireEvent.click(
      within(scopes()).getByRole("button", { name: "New project" }),
    );
    const name = screen.getByRole("textbox", { name: "Project name" });
    fireEvent.change(name, { target: { value: "  Garden " } });
    fireEvent.keyDown(name, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith({
      kind: "createProject",
      name: "Garden",
    });
    view.rerender(
      <MemoryPage
        memory={{ ...memory, projects: [...memory.projects, made] }}
        onChange={onChange}
        onClose={() => {}}
      />,
    );
    expect(
      await within(scopes()).findByRole("button", { name: /^Garden/ }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("textbox", { name: "Project name" })).toBeNull();
  });

  it("makes no project when the name is left empty or Escape is pressed", () => {
    const { onChange } = page();
    const name = () => screen.queryByRole("textbox", { name: "Project name" });
    const startNaming = () =>
      fireEvent.click(
        within(scopes()).getByRole("button", { name: "New project" }),
      );

    startNaming();
    fireEvent.change(name()!, { target: { value: "   " } });
    fireEvent.keyDown(name()!, { key: "Enter" });
    expect(name()).toBeNull();

    startNaming();
    fireEvent.change(name()!, { target: { value: "Garden" } });
    fireEvent.keyDown(name()!, { key: "Escape" });
    expect(name()).toBeNull();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("lists a project's folders, links one through Windows' dialog, and unlinks one", () => {
    const { onChange } = page();
    choose("Thesis");

    const folders = within(project()).getByRole("list", { name: "Folders" });
    expect(folders).toHaveTextContent("C:\\Users\\Lea\\Thesis");
    fireEvent.click(
      within(folders).getByRole("button", {
        name: "Unlink C:\\Users\\Lea\\Thesis",
      }),
    );
    expect(onChange).toHaveBeenCalledWith({
      kind: "unlinkFolder",
      id: "thesis",
      folder: "C:\\Users\\Lea\\Thesis",
    });

    fireEvent.click(
      within(project()).getByRole("button", { name: "Link a folder…" }),
    );
    expect(onChange).toHaveBeenCalledWith({ kind: "linkFolder", id: "thesis" });
  });

  it("says how a project without folders gathers its conversations", () => {
    page();
    choose("Kitchen");

    expect(
      within(project()).getByText(
        "No folder linked. A conversation joins it when moved to it from its menu.",
      ),
    ).toBeVisible();
  });

  it("renames a project", () => {
    const { onChange } = page();
    choose("Thesis");

    fireEvent.click(within(project()).getByRole("button", { name: "Rename" }));
    const name = within(project()).getByRole("textbox", {
      name: "Project name",
    });
    expect(name).toHaveValue("Thesis");
    fireEvent.change(name, { target: { value: "PhD thesis" } });
    fireEvent.click(within(project()).getByRole("button", { name: "Save" }));

    expect(onChange).toHaveBeenCalledWith({
      kind: "renameProject",
      id: "thesis",
      name: "PhD thesis",
    });
  });

  it("archives a project, lists it apart, and brings it back", () => {
    const { onChange } = page();
    choose("Thesis");

    fireEvent.click(within(project()).getByRole("button", { name: "Archive" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "archiveProject",
      id: "thesis",
      archived: true,
    });

    const archived = within(scopes()).getByRole("list", { name: "Archived" });
    fireEvent.click(
      within(archived).getByRole("button", { name: /^Old paper/ }),
    );
    expect(
      within(project()).getByText(
        "Archived: its memory is kept and found when asked for, but nothing of it is sent by itself.",
      ),
    ).toBeVisible();
    fireEvent.click(
      within(project()).getByRole("button", { name: "Bring back" }),
    );
    expect(onChange).toHaveBeenCalledWith({
      kind: "archiveProject",
      id: "old",
      archived: false,
    });
  });

  it("merges a project into another the person picks, then shows that one", async () => {
    const { onChange } = page();
    choose("Kitchen");

    fireEvent.click(
      within(project()).getByRole("button", { name: "Merge into…" }),
    );
    const into = within(project()).getByRole("combobox", {
      name: "Merge into",
    });
    expect(
      within(into)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Thesis"]);
    fireEvent.change(into, { target: { value: "thesis" } });
    fireEvent.click(within(project()).getByRole("button", { name: "Merge" }));

    expect(onChange).toHaveBeenCalledWith({
      kind: "mergeProject",
      from: "kitchen",
      into: "thesis",
    });
    expect(
      await within(scopes()).findByRole("button", {
        name: /^Thesis/,
        current: "page",
      }),
    ).toBeVisible();
  });

  it("deletes a project only once the person confirms, then shows everything they do", async () => {
    const { onChange } = page();
    choose("Thesis");

    fireEvent.click(within(project()).getByRole("button", { name: "Delete…" }));
    expect(
      within(project()).getByText(
        "Delete Thesis? Its memory moves to the Recycle Bin; its conversations stay.",
      ),
    ).toBeVisible();
    fireEvent.click(within(project()).getByRole("button", { name: "Keep" }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(within(project()).getByRole("button", { name: "Delete…" }));
    fireEvent.click(
      within(project()).getByRole("button", { name: "Delete project" }),
    );
    expect(onChange).toHaveBeenCalledWith({
      kind: "deleteProject",
      id: "thesis",
    });
    expect(
      await within(scopes()).findByRole("button", {
        name: /^Everything you do/,
        current: "page",
      }),
    ).toBeVisible();
  });

  it("moves a knowledge entry to another scope", () => {
    const { onChange } = page();
    choose("Thesis");
    fireEvent.click(screen.getByRole("button", { name: /Typst over LaTeX/ }));

    const where = screen.getByRole("combobox", { name: "Kept for" });
    expect(where).toHaveValue("thesis");
    fireEvent.change(where, { target: { value: "everything" } });

    expect(onChange).toHaveBeenCalledWith({
      kind: "move",
      number: 12,
      scope: "everything",
    });
  });

  it("says why memory refused a change to a project", async () => {
    page({ ok: false, reason: "A project is already called Thesis." });
    choose("Kitchen");

    fireEvent.click(within(project()).getByRole("button", { name: "Rename" }));
    fireEvent.change(
      within(project()).getByRole("textbox", { name: "Project name" }),
      {
        target: { value: "Thesis" },
      },
    );
    fireEvent.click(within(project()).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A project is already called Thesis.",
    );
    expect(
      within(project()).getByRole("textbox", { name: "Project name" }),
    ).toBeVisible();
  });
});
