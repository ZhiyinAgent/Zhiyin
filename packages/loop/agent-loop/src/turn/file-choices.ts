import { basename, sep } from "node:path";
import type { FileOffer } from "@zhiyin/permission-engine";

/**
 * The names the person picks between: the file's own, since the card names
 * its whole path above, and the folder's whole path, ending in a separator,
 * since a folder's name alone does not say where it is (ADR 0012). A file
 * Zhiyin could not copy is said to change without a backup (ADR 0013).
 */
export function fileChoices(offer: FileOffer) {
  const folder = offer.folder?.folder;
  return [
    ...(offer.file?.file
      ? [
          {
            choice: "file" as const,
            label: basename(offer.file.file),
            ...(offer.file.kind === "uncopied-file"
              ? { withoutBackup: true as const }
              : {}),
          },
        ]
      : []),
    ...(folder
      ? [
          {
            choice: "folder" as const,
            label: folder.endsWith(sep) ? folder : `${folder}${sep}`,
          },
        ]
      : []),
  ];
}
