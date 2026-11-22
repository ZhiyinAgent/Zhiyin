/**
 * The junctions and symbolic links anywhere in a folder, every folder of it
 * walked, `.git` and `node_modules` too, kept from the change journal as a
 * kept folder's files are: walked whole once, then only where the journal
 * says something changed, so asking again with nothing changed costs one
 * read of the journal. For what must refuse to work in a folder holding a
 * link that leads out of it, as git run for a sealed-off shell.
 */

import { join } from "node:path";
import { FolderIndex } from "@zhiyin/file-watch";
import { walkEveryFolder } from "@zhiyin/workspace-listing";

/** A link in a folder: its whole path, and the target it names. */
export type FolderLink = { readonly path: string; readonly target: string };

/** The links in a folder, or nothing when it cannot be said. */
export type LinksIn = (
  root: string,
) => Promise<readonly FolderLink[] | undefined>;

/** Lists the links in folders, each folder's kept from one call to the next. */
export function folderLinks(): LinksIn {
  const index = new FolderIndex(walkEveryFolder);
  return async (root) => {
    const found = await index.links(root).catch(() => undefined);
    if (!found?.ok) return undefined;
    return [...found.links].map(([path, link]) => ({
      path: join(root, path),
      target: link.slice(link.indexOf(" ") + 1),
    }));
  };
}
