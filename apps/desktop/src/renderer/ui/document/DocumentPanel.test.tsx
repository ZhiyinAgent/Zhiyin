import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentPageDrawing, DocumentPanelState } from "@zhiyin/contract";
import { DocumentPanel } from "./DocumentPanel.js";

type Opened = Exclude<DocumentPanelState, { status: "closed" }>;

const place = { path: "reports/q3.pdf", name: "q3.pdf", folder: "reports" };
const documents = [place, { path: "chart.png", name: "chart.png", folder: "" }];
const page = { width: 816, height: 1056 };

const shown: Opened = {
  ...place,
  status: "shown",
  documents,
  revision: "rev-1",
  kind: "pdf",
  pages: [page, page, page],
  openable: true,
};

const drawn = (page: number): DocumentPageDrawing => ({
  ok: true,
  data: `data:image/png;base64,page-${page}`,
  width: 816,
  height: 1056,
});

function panel(
  document: Opened,
  overrides: Partial<Parameters<typeof DocumentPanel>[0]> = {},
) {
  const props = {
    document,
    drawPage: vi.fn(async (_revision: string, number: number) => drawn(number)),
    onShow: vi.fn(),
    onOpen: vi.fn(),
    onShowInFolder: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<DocumentPanel {...props} />), props };
}

/** Lets the pages asked for arrive. */
const settle = () => act(async () => {});

beforeEach(() => {
  // jsdom lays nothing out and scrolls nothing: going to a page is asked of
  // the browser, which moves the element it is asked of to where it is told.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = function (
    this: Element,
    options?: ScrollToOptions | number,
  ) {
    if (typeof options === "object" && options.top !== undefined)
      this.scrollTop = options.top;
  } as typeof Element.prototype.scrollTo;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * A browser's layout, by hand, as jsdom has none: the pages area's size, a
 * resize observer that reports when it changes, and pages stacked in the area
 * at the size each is drawn, 12 pixels apart below a 16-pixel margin.
 */
function laidOut(initial: { width: number; height: number }, top = 300) {
  const size = { ...initial };
  const observers: (() => void)[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  const isPages = (element: Element) =>
    element.getAttribute("aria-label")?.startsWith("Pages of") ?? false;
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(
    function (this: Element) {
      return isPages(this) ? size.width : 0;
    },
  );
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(
    function (this: Element) {
      return isPages(this) ? size.height : 0;
    },
  );
  return {
    /** Stacks the pages, once they are drawn in the panel. */
    stack() {
      const pages = screen.getByRole("region", { name: /^Pages of/ });
      pages.getBoundingClientRect = () =>
        new DOMRect(0, top, size.width, size.height);
      Object.defineProperty(pages, "scrollHeight", {
        configurable: true,
        value: 10_000,
      });
      const figures = within(pages).getAllByRole("group");
      figures.forEach((figure, index) => {
        figure.getBoundingClientRect = () => {
          const above = figures
            .slice(0, index)
            .reduce((sum, each) => sum + parseFloat(each.style.height) + 12, 0);
          return new DOMRect(
            0,
            top + 16 + above - pages.scrollTop,
            parseFloat(figure.style.width),
            parseFloat(figure.style.height),
          );
        };
      });
      return pages;
    },
    resize(next: { width?: number; height?: number }) {
      Object.assign(size, next);
      act(() => observers.forEach((observe) => observe()));
    },
  };
}

describe("the panel's size beside the conversation", () => {
  it("asks for the width that fits a portrait page to the panel's height, and nothing at 100%", async () => {
    laidOut({ width: 600, height: 532 });
    const onFitHeight = vi.fn();
    panel(shown, { onFitHeight });
    await settle();

    // The page at fit-width fills the 500 pixels inside the margins: 500 tall
    // is 386 wide at its proportions, and the margins add 32.
    expect(onFitHeight).toHaveBeenCalledTimes(1);
    expect(onFitHeight.mock.calls[0]![0]).toBeCloseTo(
      (500 * 816) / 1056 + 32 - 600,
    );

    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    await settle();
    expect(onFitHeight).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Fit width" }));
    await settle();
    expect(onFitHeight).toHaveBeenCalledTimes(2);
  });

  it("asks nothing for a document of landscape pages", async () => {
    laidOut({ width: 600, height: 532 });
    const onFitHeight = vi.fn();
    panel({ ...shown, pages: [{ width: 960, height: 540 }] }, { onFitHeight });
    await settle();
    expect(onFitHeight).not.toHaveBeenCalled();
  });

  it("keeps the page being read in place, at the same point in it, when its width changes", async () => {
    const layout = laidOut({ width: 632, height: 500 });
    panel(shown);
    await settle();
    const pages = layout.stack();
    // At 600 wide each page is 776 tall: a quarter of the way into page 2.
    pages.scrollTop = 16 + 776 + 12 + 194;
    fireEvent.scroll(pages);
    expect(screen.getByText("Page 2 of 3")).toBeVisible();

    layout.resize({ width: 332 });

    // At 300 wide each page is 388 tall: still a quarter into page 2.
    expect(
      Math.abs(pages.scrollTop - (16 + 388 + 12 + 97)),
    ).toBeLessThanOrEqual(1);
    expect(screen.getByText("Page 2 of 3")).toBeVisible();
  });

  it("asks for sharper pages only once the width has stopped changing", async () => {
    vi.useFakeTimers();
    const layout = laidOut({ width: 332, height: 500 });
    const { props } = panel(shown);
    await settle();
    expect(props.drawPage).toHaveBeenCalledWith("rev-1", 1, 320);

    layout.resize({ width: 632 });
    await settle();
    expect(props.drawPage).not.toHaveBeenCalledWith("rev-1", 1, 640);
    await act(async () => vi.advanceTimersByTime(149));
    expect(props.drawPage).not.toHaveBeenCalledWith("rev-1", 1, 640);
    await act(async () => vi.advanceTimersByTime(1));
    expect(props.drawPage).toHaveBeenCalledWith("rev-1", 1, 640);
  });
});

describe("DocumentPanel", () => {
  it("names the document and its folder, and says it is opening", () => {
    panel({ ...place, status: "opening", documents });
    const region = screen.getByRole("complementary", { name: "Document" });
    expect(
      within(region).getByRole("heading", { name: "q3.pdf" }),
    ).toBeVisible();
    expect(within(region).getByText("reports")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Opening q3.pdf…");
  });

  it("draws the first pages and shows each as a picture of that page", async () => {
    const { props } = panel({ ...shown, pages: [page, page, page, page] });
    await settle();
    // The page being read and the two after it.
    expect(props.drawPage).toHaveBeenCalledWith("rev-1", 1, expect.any(Number));
    expect(props.drawPage).toHaveBeenCalledWith("rev-1", 2, expect.any(Number));
    expect(props.drawPage).toHaveBeenCalledWith("rev-1", 3, expect.any(Number));
    expect(props.drawPage).not.toHaveBeenCalledWith(
      "rev-1",
      4,
      expect.any(Number),
    );
    expect(
      screen.getByRole("img", { name: "Page 1 of q3.pdf" }),
    ).toHaveAttribute("src", "data:image/png;base64,page-1");
    expect(screen.getByText("Page 1 of 4")).toBeVisible();
  });

  it("never lets a page be dragged out of the panel, even inside a selection", async () => {
    panel(shown);
    await settle();

    // A selection drags its pictures with it, whatever each says about itself.
    const dragged = fireEvent.dragStart(
      screen.getByRole("img", { name: "Page 1 of q3.pdf" }),
    );

    expect(dragged).toBe(false);
  });

  it("says a page could not be drawn in its place, never an empty page", async () => {
    panel(shown, {
      drawPage: vi.fn(async (_revision: string, number: number) =>
        number === 1
          ? { ok: false as const, reason: "Page 1 could not be drawn." }
          : drawn(number),
      ),
    });
    await settle();
    expect(screen.getByText("Page 1 could not be drawn.")).toBeVisible();
    expect(screen.queryByRole("img", { name: "Page 1 of q3.pdf" })).toBeNull();
  });

  it("asks once more for a page whose drawing ended with another page's, and shows it", async () => {
    // One page stuck in the drawing process ends the answers queued behind it.
    let refused = false;
    const drawPage = vi.fn(async (_revision: string, number: number) => {
      if (number === 2 && !refused) {
        refused = true;
        return { ok: false as const, reason: "Page 2 could not be drawn." };
      }
      return drawn(number);
    });
    panel(shown, { drawPage });
    await settle();
    await settle();

    expect(screen.getByRole("img", { name: "Page 2 of q3.pdf" })).toBeVisible();
    expect(screen.queryByText("Page 2 could not be drawn.")).toBeNull();
  });

  it("keeps every page of a 50-page document drawn while they fit in about 64 MB", async () => {
    const fifty: Opened = {
      ...shown,
      pages: Array.from({ length: 50 }, () => page),
    };
    panel(fifty);
    const pages = screen.getByRole("region", { name: "Pages of q3.pdf" });

    for (let step = 0; step < 49; step += 1) {
      fireEvent.keyDown(pages, { key: "PageDown" });
      await settle();
    }

    expect(within(pages).getAllByRole("img")).toHaveLength(50);
  });

  it("draws the next two pages ahead in the direction the reader moves", async () => {
    const long: Opened = {
      ...shown,
      pages: Array.from({ length: 60 }, () => page),
    };
    const drawPage = vi.fn(async (_revision: string, number: number) =>
      drawn(number),
    );
    const { rerender, props } = panel(long, { drawPage });
    const pages = screen.getByRole("region", { name: "Pages of q3.pdf" });
    const asked = () => drawPage.mock.calls.map(([, number]) => number);

    fireEvent.keyDown(pages, { key: "PageDown" });
    fireEvent.keyDown(pages, { key: "PageDown" });
    await settle();
    expect(asked()).toEqual(expect.arrayContaining([3, 4, 5]));

    // Sent back to page 30 from the end: the pages before it come next.
    fireEvent.keyDown(pages, { key: "End" });
    await settle();
    drawPage.mockClear();
    rerender(
      <DocumentPanel
        {...props}
        document={{ ...long, pointed: { page: 30, count: 1 } }}
      />,
    );
    await settle();
    expect(asked()).toEqual(expect.arrayContaining([30, 29, 28]));
    expect(asked()).not.toContain(31);
  });

  it("draws the pages after the first ahead when the reader is back at the start", async () => {
    const long: Opened = {
      ...shown,
      pages: Array.from({ length: 60 }, () => page),
    };
    const drawPage = vi.fn(async (_revision: string, number: number) =>
      drawn(number),
    );
    const { rerender, props } = panel(long, { drawPage });
    const pages = screen.getByRole("region", { name: "Pages of q3.pdf" });
    fireEvent.keyDown(pages, { key: "End" });
    await settle();
    fireEvent.keyDown(pages, { key: "Home" });
    await settle();
    drawPage.mockClear();

    // The file is written again, so every page is drawn anew.
    rerender(
      <DocumentPanel {...props} document={{ ...long, revision: "rev-2" }} />,
    );
    await settle();

    expect(drawPage.mock.calls.map(([, number]) => number)).toEqual(
      expect.arrayContaining([1, 2, 3]),
    );
  });

  it("keeps drawn pages to about 64 MB, and draws one scrolled back to again", async () => {
    const long: Opened = {
      ...shown,
      pages: Array.from({ length: 30 }, () => page),
    };
    // Each drawing 4 MB, so 16 pages fill the bound.
    const large = "A".repeat(4 * 1024 * 1024);
    const drawPage = vi.fn(async (_revision: string, number: number) => ({
      ...drawn(number),
      data: `data:image/png;base64,${large}`,
    }));
    panel(long, { drawPage });
    const pages = screen.getByRole("region", { name: "Pages of q3.pdf" });

    for (let step = 0; step < 29; step += 1) {
      fireEvent.keyDown(pages, { key: "PageDown" });
      await settle();
    }

    // 15 of 4 MB fit, and a 16th would pass the bound.
    expect(within(pages).getAllByRole("img")).toHaveLength(15);
    drawPage.mockClear();
    fireEvent.keyDown(pages, { key: "Home" });
    await settle();
    expect(drawPage).toHaveBeenCalledWith("rev-1", 1, expect.any(Number));
    expect(screen.getByRole("img", { name: "Page 1 of q3.pdf" })).toBeVisible();
  });

  it("never lets go of a page in view, however many are", async () => {
    // Small pages: forty of them in view at once.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          private readonly report: (
            entries: { target: Element; isIntersecting: boolean }[],
          ) => void,
        ) {}
        observe(target: Element) {
          this.report([{ target, isIntersecting: true }]);
        }
        disconnect() {}
      },
    );
    const many: Opened = {
      ...shown,
      pages: Array.from({ length: 40 }, () => page),
    };
    panel(many);
    await settle();
    await settle();

    const pages = screen.getByRole("region", { name: "Pages of q3.pdf" });
    expect(within(pages).getAllByRole("img")).toHaveLength(40);
  });

  it("says why a document cannot be shown, and still offers Open and Show in folder", () => {
    const { props } = panel({
      ...place,
      status: "failed",
      documents,
      reason:
        "q3.pdf is protected by a password, so its pages cannot be shown.",
      openable: true,
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "q3.pdf is protected by a password, so its pages cannot be shown.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(props.onOpen).toHaveBeenCalledWith("reports/q3.pdf");
    expect(props.onShowInFolder).toHaveBeenCalledWith("reports/q3.pdf");
  });

  it("offers Open only for a type Windows may open, and Show in folder always", () => {
    panel({ ...shown, openable: false });
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show in folder" }),
    ).toBeVisible();
  });

  it("goes to the page the agent pointed at, each time it points", async () => {
    const { rerender, props } = panel(shown);
    await settle();
    rerender(
      <DocumentPanel
        {...props}
        document={{ ...shown, pointed: { page: 3, count: 1 } }}
      />,
    );
    await settle();
    expect(screen.getByText("Page 3 of 3")).toBeVisible();
    expect(props.drawPage).toHaveBeenCalledWith("rev-1", 3, expect.any(Number));

    fireEvent.keyDown(screen.getByRole("region", { name: "Pages of q3.pdf" }), {
      key: "Home",
    });
    rerender(
      <DocumentPanel
        {...props}
        document={{ ...shown, pointed: { page: 3, count: 2 } }}
      />,
    );
    expect(screen.getByText("Page 3 of 3")).toBeVisible();
  });

  it("moves a page at a time with Page Up and Page Down, and to either end with Home and End", () => {
    panel(shown);
    const pages = screen.getByRole("region", { name: "Pages of q3.pdf" });
    fireEvent.keyDown(pages, { key: "PageDown" });
    expect(screen.getByText("Page 2 of 3")).toBeVisible();
    fireEvent.keyDown(pages, { key: "End" });
    expect(screen.getByText("Page 3 of 3")).toBeVisible();
    fireEvent.keyDown(pages, { key: "PageDown" });
    expect(screen.getByText("Page 3 of 3")).toBeVisible();
    fireEvent.keyDown(pages, { key: "PageUp" });
    expect(screen.getByText("Page 2 of 3")).toBeVisible();
    fireEvent.keyDown(pages, { key: "Home" });
    expect(screen.getByText("Page 1 of 3")).toBeVisible();
  });

  it("counts the page being read as the reader scrolls, wherever the panel sits in the window", () => {
    panel(shown);
    const pages = screen.getByRole("region", { name: "Pages of q3.pdf" });
    // Laid out as a browser would: the panel 300 pixels down the window,
    // 500 tall, pages 1,000 apart inside it.
    const panelTop = 300;
    Object.defineProperty(pages, "clientHeight", { value: 500 });
    Object.defineProperty(pages, "scrollHeight", { value: 3_100 });
    pages.getBoundingClientRect = () => new DOMRect(0, panelTop, 600, 500);
    for (const figure of within(pages).getAllByRole("group")) {
      const index = Number(figure.dataset["page"]) - 1;
      Object.defineProperty(figure, "offsetTop", {
        value: panelTop + 16 + index * 1_000,
      });
      figure.getBoundingClientRect = () =>
        new DOMRect(
          0,
          panelTop + 16 + index * 1_000 - pages.scrollTop,
          600,
          980,
        );
    }

    pages.scrollTop = 1_000;
    fireEvent.scroll(pages);
    expect(screen.getByText("Page 2 of 3")).toBeVisible();
    pages.scrollTop = 100;
    fireEvent.scroll(pages);
    expect(screen.getByText("Page 1 of 3")).toBeVisible();
    pages.scrollTop = 2_600;
    fireEvent.scroll(pages);
    expect(screen.getByText("Page 3 of 3")).toBeVisible();
  });

  // A cited page is reached by scrolling the pages alone: scrolling the whole
  // window would take the panel's bar off the top.
  it("goes to a page by scrolling its own pages, never the window around it", async () => {
    const { rerender, props } = panel(shown);
    await settle();
    const pages = screen.getByRole("region", { name: "Pages of q3.pdf" });
    // Laid out as a browser would: the panel 300 pixels down the window,
    // pages 1,000 apart inside it, each 16 pixels below the one before's gap.
    const panelTop = 300;
    pages.getBoundingClientRect = () => new DOMRect(0, panelTop, 600, 500);
    for (const figure of within(pages).getAllByRole("group")) {
      const index = Number(figure.dataset["page"]) - 1;
      figure.getBoundingClientRect = () =>
        new DOMRect(
          0,
          panelTop + 16 + index * 1_000 - pages.scrollTop,
          600,
          980,
        );
    }
    const windowWide = vi.mocked(Element.prototype.scrollIntoView);
    windowWide.mockClear();

    rerender(
      <DocumentPanel
        {...props}
        document={{ ...shown, pointed: { page: 3, count: 1 } }}
      />,
    );
    await settle();

    expect(pages.scrollTop).toBe(2_016);
    expect(windowWide).not.toHaveBeenCalled();
  });

  it("fits pages to the panel's width, or shows them at their own size", () => {
    panel(shown);
    const fit = screen.getByRole("button", { name: "Fit width" });
    const actual = screen.getByRole("button", { name: "100%" });
    expect(fit).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(actual);
    expect(actual).toHaveAttribute("aria-pressed", "true");
    expect(fit).toHaveAttribute("aria-pressed", "false");
    // At its own size a page is as wide as the document says it is.
    expect(screen.getByRole("group", { name: "Page 1" }).style.width).toBe(
      "816px",
    );
  });

  it("lists the conversation's documents and shows the one chosen", () => {
    const { props } = panel(shown);
    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    const list = screen.getByRole("list", {
      name: "This conversation's documents",
    });
    expect(
      within(list).getByRole("button", { name: /q3\.pdf/ }),
    ).toHaveAttribute("aria-current", "true");
    fireEvent.click(within(list).getByRole("button", { name: /chart\.png/ }));
    expect(props.onShow).toHaveBeenCalledWith("chart.png");
    expect(
      screen.queryByRole("list", { name: "This conversation's documents" }),
    ).toBeNull();
  });

  it("closes the list on Escape wherever focus is in it, and returns focus to its button", () => {
    panel(shown);
    const button = screen.getByRole("button", { name: "Documents" });
    button.focus();
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(
      screen.queryByRole("list", { name: "This conversation's documents" }),
    ).toBeNull();

    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("button", { name: /chart.png/ }), {
      key: "Escape",
    });
    expect(
      screen.queryByRole("list", { name: "This conversation's documents" }),
    ).toBeNull();
    expect(button).toHaveFocus();
  });

  it("offers no list for a conversation with one document", () => {
    panel({ ...shown, documents: [place] });
    expect(screen.queryByRole("button", { name: "Documents" })).toBeNull();
  });

  it("draws the pages again for a new version of the file", async () => {
    const { rerender, props } = panel(shown);
    await settle();
    rerender(
      <DocumentPanel {...props} document={{ ...shown, revision: "rev-2" }} />,
    );
    await settle();
    expect(props.drawPage).toHaveBeenCalledWith("rev-2", 1, expect.any(Number));
  });

  it("fits a picture whole into the panel, its height as well as its width", async () => {
    laidOut({ width: 600, height: 532 });
    panel({
      path: "renders/stand.png",
      name: "stand.png",
      folder: "renders",
      status: "shown",
      documents,
      revision: "rev-s",
      kind: "picture",
      pages: [{ width: 1600, height: 1600 }],
      openable: true,
    });
    await settle();

    // 500 pixels tall inside the margins, so a square picture is 500 wide,
    // not the 568 the width alone would allow.
    expect(screen.getByRole("group", { name: "stand.png" }).style.width).toBe(
      "500px",
    );
    expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows a picture as itself, without page numbers", async () => {
    panel({
      path: "chart.png",
      name: "chart.png",
      folder: "",
      status: "shown",
      documents,
      revision: "rev-p",
      kind: "picture",
      pages: [{ width: 640, height: 480 }],
      openable: true,
    });
    await settle();
    expect(screen.getByRole("img", { name: "chart.png" })).toBeVisible();
    expect(screen.queryByText(/Page 1 of/)).toBeNull();
  });

  it("asks for the document to be closed, and closes nothing itself", () => {
    const { props } = panel(shown);
    fireEvent.click(screen.getByRole("button", { name: "Close document" }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
