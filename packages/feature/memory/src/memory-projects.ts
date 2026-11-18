/**
 * The projects memory keeps: their names, the folders linked to each, and
 * merging and deleting them. Each change reads the folder afresh; the caller
 * runs them one at a time.
 */

import type { MemoryProject } from "@zhiyin/contract";
import type { PersonsOutcome } from "./memory.js";
import type { MemoryFolder, StoredProject } from "./memory-folder.js";
import { isBroad, projectLinking, sameFolder } from "./folders.js";
import { ok, projectOnly, refused } from "./outcomes.js";

export type MemoryProjectsOptions = {
  readonly now: () => Date;
  readonly newId: () => string;
  /** Folders where work of every kind passes, never linked to a project. */
  readonly broadFolders: readonly string[];
  /** Moves a folder to the Recycle Bin; without one, nothing is deleted. */
  readonly recycle?: ((path: string) => Promise<void>) | undefined;
};

const noRecycleBin =
  "There is no Recycle Bin here to move it to, so it was kept.";

export class MemoryProjects {
  readonly #folder: MemoryFolder;
  readonly #options: MemoryProjectsOptions;

  constructor(folder: MemoryFolder, options: MemoryProjectsOptions) {
    this.#folder = folder;
    this.#options = options;
  }

  async create(
    name: string,
    folders: readonly string[],
  ): Promise<PersonsOutcome & { readonly project?: MemoryProject }> {
    const snapshot = await this.#folder.read();
    const named = nameProblem(name, snapshot.projects);
    if (named) return refused(named);
    for (const folder of folders) {
      const problem = this.#linkProblem(folder, undefined, snapshot.projects);
      if (problem) return refused(problem);
    }
    const folder = await this.#folder.projectFolderFor(name.trim());
    const project: StoredProject = {
      id: this.#options.newId(),
      name: name.trim(),
      folders: [...folders],
      created: this.#options.now().toISOString(),
      folder,
    };
    await this.#folder.saveProject(project);
    return { ok: true, project: projectOnly(project) };
  }

  rename(id: string, name: string): Promise<PersonsOutcome> {
    return this.#change(
      id,
      (project, projects) =>
        nameProblem(name, projects, id) ?? { ...project, name: name.trim() },
    );
  }

  link(id: string, folder: string): Promise<PersonsOutcome> {
    return this.#change(id, (project, projects) => {
      const problem = this.#linkProblem(folder, id, projects);
      if (problem) return problem;
      if (project.folders.some((one) => sameFolder(one, folder)))
        return project;
      return { ...project, folders: [...project.folders, folder] };
    });
  }

  unlink(id: string, folder: string): Promise<PersonsOutcome> {
    return this.#change(id, (project) => ({
      ...project,
      folders: project.folders.filter((one) => !sameFolder(one, folder)),
    }));
  }

  archive(id: string, archived: boolean): Promise<PersonsOutcome> {
    return this.#change(id, (project) => {
      if (archived) return { ...project, archived: true as const };
      const kept: StoredProject = { ...project };
      delete (kept as { archived?: true }).archived;
      return kept;
    });
  }

  /**
   * The project merged into takes the folders and the merged ids first, so a
   * merge that stops halfway leaves a link twice rather than none, and doing
   * it again adds nothing twice.
   */
  async merge(from: string, into: string): Promise<PersonsOutcome> {
    const snapshot = await this.#folder.read();
    const source = snapshot.projects.find((one) => one.id === from);
    const target = snapshot.projects.find((one) => one.id === into);
    if (!source || !target || from === into)
      return refused("That project is no longer kept.");
    for (const section of ["brief", "how"] as const) {
      const both = [from, into].every((scope) =>
        snapshot.entries.some(
          (entry) => entry.scope === scope && entry.section === section,
        ),
      );
      if (both)
        return refused(
          `Both projects have ${section === "brief" ? "a brief" : "a How to work"}. Join the two into one first, then merge.`,
        );
    }
    const recycle = this.#options.recycle;
    if (!recycle) return refused(noRecycleBin);
    await this.#folder.moveProjectFiles(source.folder, target.folder);
    await this.#folder.saveProject({
      ...target,
      folders: [...new Set([...target.folders, ...source.folders])],
      merged: [
        ...new Set([...(target.merged ?? []), from, ...(source.merged ?? [])]),
      ],
    });
    await this.#folder.saveProject({ ...source, folders: [] });
    await recycle(this.#folder.projectPath(source.folder));
    return ok;
  }

  async delete(id: string): Promise<PersonsOutcome> {
    const { projects } = await this.#folder.read();
    const project = projects.find((one) => one.id === id);
    if (!project) return refused("That project is no longer kept.");
    const recycle = this.#options.recycle;
    if (!recycle) return refused(noRecycleBin);
    await recycle(this.#folder.projectPath(project.folder));
    return ok;
  }

  #linkProblem(
    folder: string,
    project: string | undefined,
    projects: readonly StoredProject[],
  ): string | undefined {
    if (isBroad(folder, this.#options.broadFolders))
      return `${folder} holds work of every kind, so it is never linked to a project. Pick a folder inside it.`;
    const linked = projectLinking(folder, projects);
    if (linked && linked.id !== project)
      return `${folder} is already linked to ${linked.name}.`;
    return undefined;
  }

  async #change(
    id: string,
    change: (
      project: StoredProject,
      projects: readonly StoredProject[],
    ) => StoredProject | string,
  ): Promise<PersonsOutcome> {
    const { projects } = await this.#folder.read();
    const project = projects.find((one) => one.id === id);
    if (!project) return refused("That project is no longer kept.");
    const changed = change(project, projects);
    if (typeof changed === "string") return refused(changed);
    await this.#folder.saveProject(changed);
    return ok;
  }
}

/** Why a project cannot take this name, or nothing. */
function nameProblem(
  name: string,
  projects: readonly StoredProject[],
  except?: string,
): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "A project needs a name.";
  if (/[\r\n]/.test(trimmed)) return "A project's name is one line.";
  const same = projects.find(
    (one) =>
      one.id !== except &&
      one.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
  );
  return same ? `A project is already called ${same.name}.` : undefined;
}
