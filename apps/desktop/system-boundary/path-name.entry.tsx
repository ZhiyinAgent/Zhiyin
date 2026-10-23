/**
 * The page the path-name test drives: the production file name, with the
 * application's stylesheets.
 */

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../src/renderer/styles.css";
import { PathName } from "../src/renderer/ui/shared/PathName.js";

export type PathNamePage = {
  /**
   * How wide the name is drawn, and how wide the same text is as one run of
   * text with every space kept, in the same font, in pixels.
   */
  widths(path: string): { readonly drawn: number; readonly written: number };
};

const stage = document.getElementById("stage")!;
stage.style.width = "900px";
const holder = document.createElement("div");
const written = document.createElement("span");
written.style.whiteSpace = "pre";
stage.append(holder, written);
const root = createRoot(holder);

const page: PathNamePage = {
  widths(path) {
    flushSync(() => root.render(<PathName path={path} />));
    written.textContent = path;
    return {
      drawn: (holder.firstElementChild as HTMLElement).getBoundingClientRect()
        .width,
      written: written.getBoundingClientRect().width,
    };
  },
};

(window as unknown as { pathName: PathNamePage }).pathName = page;
