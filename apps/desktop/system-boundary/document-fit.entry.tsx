/**
 * The page the document-fit test drives: the production document panel, with
 * the application's stylesheets, in a space of a size the test chooses.
 */

import { createRoot, type Root } from "react-dom/client";
import "../src/renderer/styles.css";
import { DocumentPanel } from "../src/renderer/ui/document/index.js";

type Size = { readonly width: number; readonly height: number };

export type DocumentFitPage = {
  /**
   * Opens a one-page document of this size, a picture or a PDF, in a panel
   * whose space is this size.
   */
  show(space: Size, page: Size, kind: "picture" | "pdf"): void;
  /** Takes the panel away, so the next picture is opened afresh. */
  close(): void;
  /** The space the pages scroll in, and what stands above it in the panel. */
  measured(): { readonly across: number; readonly above: number };
  /**
   * Where the page is drawn within the space the pages scroll in: from its
   * sides, the scrollbar's room included, and from the top and bottom of what
   * shows; and how far that space can scroll.
   */
  placed(): {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
    readonly scrolls: number;
  };
  /** Every width the page takes over a time, in the order it takes them. */
  widths(milliseconds: number): Promise<readonly number[]>;
};

const stage = document.getElementById("stage")!;
let root: Root | undefined;

/** One transparent pixel, standing for any drawing of the page. */
const drawing =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const page: DocumentFitPage = {
  show(space, size, kind) {
    stage.style.display = "flex";
    stage.style.width = `${space.width}px`;
    stage.style.height = `${space.height}px`;
    root ??= createRoot(stage);
    const name = kind === "pdf" ? "plan.pdf" : "plan.png";
    root.render(
      <DocumentPanel
        document={{
          status: "shown",
          path: name,
          name,
          folder: "",
          kind,
          revision: "one",
          pages: [size],
          openable: true,
          documents: [{ path: name, name, folder: "" }],
        }}
        drawPage={async (_revision, _page, width) => ({
          ok: true,
          data: drawing,
          width,
          height: Math.round((width * size.height) / size.width),
        })}
        onShow={() => undefined}
        onOpen={() => undefined}
        onShowInFolder={() => undefined}
        onClose={() => undefined}
      />,
    );
  },
  close() {
    root?.unmount();
    root = undefined;
  },
  measured() {
    const pages = stage.querySelector<HTMLElement>('[role="region"]')!;
    return {
      // With whatever room a scrollbar is given, so the same on every page.
      across: pages.offsetWidth,
      above:
        pages.getBoundingClientRect().top - stage.getBoundingClientRect().top,
    };
  },
  placed() {
    const pages = stage.querySelector<HTMLElement>('[role="region"]')!;
    const space = pages.getBoundingClientRect();
    const figure = stage.querySelector("figure")!.getBoundingClientRect();
    return {
      left: figure.left - space.left,
      right: space.right - figure.right,
      top: figure.top - space.top,
      bottom: space.top + pages.clientHeight - figure.bottom,
      scrolls: pages.scrollHeight - pages.clientHeight,
    };
  },
  widths(milliseconds) {
    return new Promise((resolve) => {
      const seen: number[] = [];
      const started = performance.now();
      const look = () => {
        const width = stage
          .querySelector("figure")
          ?.getBoundingClientRect().width;
        if (width !== undefined && seen.at(-1) !== width) seen.push(width);
        if (performance.now() - started < milliseconds)
          requestAnimationFrame(look);
        else resolve(seen);
      };
      look();
    });
  },
};

(window as unknown as { documentFit: DocumentFitPage }).documentFit = page;
