/**
 * What the panel, and the agent's tools, say in place of pages. Each names
 * what happened rather than guessing, and is the same sentence wherever it is
 * shown, so the agent is never told something other than what the person sees.
 */

function size(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const pages = (count: number) => `${count} ${count === 1 ? "page" : "pages"}`;

export const sentences = {
  noFolder: "No folder is chosen, so there is no document to show.",
  outside: (path: string) =>
    `${path} is outside the folder this conversation works in, so it is not shown.`,
  outsideFolder: (path: string) =>
    `${path} is outside the folder this conversation works in.`,
  missing: (name: string) =>
    `${name} is not in the workspace. It may have been moved, renamed or deleted.`,
  notAFile: (name: string) => `${name} is a folder, not a document.`,
  unreadable: (name: string) =>
    `${name} could not be read. Check that the folder is readable.`,
  tooLarge: (name: string, bytes: number) =>
    `${name} is ${size(bytes)}, larger than the 100 MB this panel draws. Open it in its own app or save a copy instead.`,
  tooManyPages: (name: string, count: number) =>
    `${name} has ${count} pages, more than the 2,000 this panel draws.`,
  damaged: (name: string) => `${name} could not be opened. It may be damaged.`,
  damagedPicture: (name: string) =>
    `${name} could not be read as a picture. It may be damaged.`,
  protected: (name: string) =>
    `${name} is protected by a password, so its pages cannot be shown.`,
  other: (name: string) =>
    `${name} is not a PDF or a picture this panel can draw.`,
  undrawn: (name: string) => `${name} could not be drawn.`,
  uncontained: (name: string) =>
    `${name} could not be drawn, because Zhiyin could not start a contained process to draw it.`,
  noSuchPage: (name: string, count: number, page: number) =>
    `${name} has ${pages(count)}, so there is no page ${page}.`,
  pageUndrawn: (page: number) => `Page ${page} could not be drawn.`,
  staleRevision: "This version of the document is no longer shown.",
} as const;
