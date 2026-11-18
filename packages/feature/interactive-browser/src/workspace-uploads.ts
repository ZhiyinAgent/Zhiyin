/**
 * Files the agent hands a page's file chooser: only those in the
 * conversation's folder, named by their path inside it, with links resolved.
 * The approval is bound to the site the page is
 * on and to each file's content, so nothing is sent to another site, or once a
 * file changed after approval. What the page receives is a copy kept in the
 * conversation's own browser folder, the one place the browser reads from.
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { realStaysInside, staysInside } from "@zhiyin/workspace-containment";

export type UploadFile = {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
};

/** The site a page is on, by its origin: the one an upload approved there reaches. */
function siteOf(page: string): string {
  try {
    return new URL(page).origin;
  } catch {
    return page;
  }
}

/** What an upload's approval is bound to: the site and each file's content. */
export function uploadBinding(
  page: string,
  files: readonly UploadFile[],
): string {
  return JSON.stringify({ site: siteOf(page), files });
}

function digest(path: string): Promise<string> {
  return new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => done(hash.digest("hex")))
      .on("error", fail);
  });
}

const outsideFolder =
  "Only files in the open folder can be uploaded. Name each by its path inside the folder.";

export class WorkspaceUploads {
  readonly #workspace: () => string | undefined;

  constructor(workspace: () => string | undefined) {
    this.#workspace = workspace;
  }

  /** The files as they are now, or an error saying why they cannot be sent. */
  async inspect(paths: readonly string[]): Promise<readonly UploadFile[]> {
    return (await this.#resolve(paths)).files;
  }

  /**
   * Copies the files into `directory` once the page is still on the site and
   * the files still hold what was approved, and answers where each copy is.
   */
  async stage(
    paths: readonly string[],
    directory: string,
    approved: string | undefined,
    page: string,
  ): Promise<readonly string[]> {
    const { root, files } = await this.#resolve(paths);
    if (approved !== undefined && uploadBinding(page, files) !== approved) {
      const site = (JSON.parse(approved) as { site?: string }).site;
      throw new Error(
        site !== siteOf(page)
          ? "The page moved to another site after the upload was approved. Ask again."
          : "A file changed after its upload was approved. Ask again.",
      );
    }
    const into = join(directory, "uploads", randomUUID());
    // One folder each, so two files of the same name both arrive.
    return Promise.all(
      files.map(async (file, index) => {
        const copy = join(into, String(index), basename(file.path));
        await mkdir(join(into, String(index)), { recursive: true });
        await copyFile(join(root, file.path), copy);
        return copy;
      }),
    );
  }

  async #resolve(paths: readonly string[]): Promise<{
    readonly root: string;
    readonly files: readonly UploadFile[];
  }> {
    const selected = this.#workspace();
    if (!selected)
      throw new Error("Choose a folder first: only its files can be uploaded.");
    const root = await realpath(selected);
    const files = await Promise.all(
      paths.map(async (given): Promise<UploadFile> => {
        if (isAbsolute(given) || /^[a-z]:/i.test(given))
          throw new Error(outsideFolder);
        const named = resolve(root, given);
        if (!staysInside(root, named)) throw new Error(outsideFolder);
        let file: string;
        try {
          file = await realpath(named);
        } catch {
          throw new Error(`${given} was not found in the open folder.`);
        }
        if (!realStaysInside(root, file)) throw new Error(outsideFolder);
        const found = await stat(file);
        if (!found.isFile()) throw new Error(`${given} is not a file.`);
        return {
          path: relative(root, file).replaceAll("\\", "/"),
          bytes: found.size,
          sha256: await digest(file),
        };
      }),
    );
    return { root, files };
  }
}
