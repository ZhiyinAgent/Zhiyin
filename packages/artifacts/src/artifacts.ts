import { copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { locateInside } from "@zhiyin/workspace-containment";
import type {
  ArtifactExport,
  ArtifactPreview,
  ProducedFile,
  TaskArtifact,
} from "@zhiyin/contract";

const maximumArtifacts = 50;
const maximumPreviewBytes = 256 * 1024;
const maximumPreviewCharacters = 20_000;

/** Asked for the destination at the moment of export, never before. */
export type DestinationChooser = (
  suggestedName: string,
) => Promise<string | undefined>;

export interface Artifacts {
  /**
   * Folds what an action produced into a task's existing record. Pure: the
   * caller owns when the result is persisted.
   */
  record(
    existing: readonly TaskArtifact[],
    produced: readonly ProducedFile[],
    at: Date,
  ): readonly TaskArtifact[];

  preview(artifact: TaskArtifact): Promise<ArtifactPreview>;

  exportTo(
    artifact: TaskArtifact,
    chooseDestination: DestinationChooser,
  ): Promise<ArtifactExport>;

  /** Writes a renderer-produced inert image only after a direct user request. */
  /**
   * Saves a rendered view. The file is named from the view's title here,
   * because what a produced file is called is this feature's business and
   * nowhere else's.
   */
  exportView(
    viewTitle: string,
    svg: string,
    chooseDestination: DestinationChooser,
  ): Promise<ArtifactExport>;
}

/**
 * What a saved view is called: the title the person sees, reduced to something
 * every filesystem accepts. A title of nothing but punctuation still has to
 * produce a name, so it falls back to `view`.
 */
function viewFileName(viewTitle: string): string {
  const stem =
    viewTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "view";
  return `${stem}.svg`;
}

type Located =
  | { readonly kind: "found"; readonly path: string }
  | {
      readonly kind: "missing" | "unreadable";
      readonly reason: string;
    };

function missingReason(artifact: TaskArtifact): string {
  return `${artifact.name} is no longer in the workspace. It may have been moved, renamed, or deleted outside Zhiyin.`;
}

export class WorkspaceArtifacts implements Artifacts {
  readonly #root: () => string | undefined;

  constructor(workspaceRoot: () => string | undefined) {
    this.#root = workspaceRoot;
  }

  record(
    existing: readonly TaskArtifact[],
    produced: readonly ProducedFile[],
    at: Date,
  ): readonly TaskArtifact[] {
    const updatedAt = at.toISOString();
    const byPath = new Map(existing.map((item) => [item.path, item]));
    const touched: TaskArtifact[] = [];
    for (const file of produced) {
      const known = byPath.get(file.path);
      byPath.delete(file.path);
      touched.push({
        path: file.path,
        name: basename(file.path),
        // What the task did the first time it touched this file, not what the
        // most recent action happened to do to it.
        change: known?.change ?? file.change,
        bytes: file.bytes,
        updatedAt,
      });
    }
    return [...touched.reverse(), ...byPath.values()].slice(
      0,
      maximumArtifacts,
    );
  }

  /**
   * A recorded path is data that has been through a saved file and back, so
   * containment is re-checked on every read.
   */
  async #locate(artifact: TaskArtifact): Promise<Located> {
    const root = this.#root();
    if (!root)
      return {
        kind: "unreadable",
        reason: "No folder is selected, so this file cannot be opened.",
      };
    const located = await locateInside(root, artifact.path);
    switch (located.kind) {
      case "found":
        return located;
      case "outside":
        return {
          kind: "unreadable",
          reason: "This file is not inside the current workspace.",
        };
      case "not-a-file":
        return {
          kind: "unreadable",
          reason: `${artifact.name} is no longer an ordinary file.`,
        };
      case "missing":
        return { kind: "missing", reason: missingReason(artifact) };
      case "unreadable":
        return {
          kind: "unreadable",
          reason: `${artifact.name} could not be opened. Check that the folder is readable.`,
        };
    }
  }

  async preview(artifact: TaskArtifact): Promise<ArtifactPreview> {
    const located = await this.#locate(artifact);
    if (located.kind !== "found")
      return {
        status: located.kind,
        path: artifact.path,
        reason: located.reason,
      };

    let contents: Buffer;
    try {
      const size = (await stat(located.path)).size;
      if (size > maximumPreviewBytes) {
        return {
          status: "unreadable",
          path: artifact.path,
          reason: `${artifact.name} is too large to show here. Export it to open it in another app.`,
        };
      }
      contents = await readFile(located.path);
    } catch {
      return {
        status: "unreadable",
        path: artifact.path,
        reason: `${artifact.name} could not be read. Check that it is readable.`,
      };
    }

    if (contents.includes(0)) {
      return {
        status: "unreadable",
        path: artifact.path,
        reason: `${artifact.name} is not a text file, so it cannot be shown here. Export it to open it in another app.`,
      };
    }
    const text = contents.toString("utf8");
    return {
      status: "ready",
      path: artifact.path,
      text: text.slice(0, maximumPreviewCharacters),
      truncated: text.length > maximumPreviewCharacters,
    };
  }

  async exportTo(
    artifact: TaskArtifact,
    chooseDestination: DestinationChooser,
  ): Promise<ArtifactExport> {
    const located = await this.#locate(artifact);
    if (located.kind !== "found")
      return { status: "failed", reason: located.reason };

    const destination = await chooseDestination(artifact.name);
    if (!destination) return { status: "cancelled" };

    try {
      await copyFile(located.path, destination);
      return { status: "saved", destination };
    } catch {
      return {
        status: "failed",
        reason: `${artifact.name} could not be saved to that location. Check that the folder exists and allows changes.`,
      };
    }
  }

  async exportView(
    viewTitle: string,
    svg: string,
    chooseDestination: DestinationChooser,
  ): Promise<ArtifactExport> {
    if (
      svg.length > 2_000_000 ||
      !/^\s*<svg[\s>]/i.test(svg) ||
      /<(?:script|foreignObject|iframe|object|embed)\b/i.test(svg) ||
      /\son[a-z]+\s*=/i.test(svg) ||
      /\b(?:href|src)\s*=\s*["'](?!#)[^"']+/i.test(svg)
    )
      return {
        status: "failed",
        reason:
          "The rendered image contains content that cannot be saved safely.",
      };

    const destination = await chooseDestination(viewFileName(viewTitle));
    if (!destination) return { status: "cancelled" };
    try {
      await writeFile(destination, svg, "utf8");
      return { status: "saved", destination };
    } catch {
      return {
        status: "failed",
        reason:
          "The image could not be saved to that location. Check that the folder exists and allows changes.",
      };
    }
  }
}
