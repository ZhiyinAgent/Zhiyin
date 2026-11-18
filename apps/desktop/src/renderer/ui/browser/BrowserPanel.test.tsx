import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BrowserIntent, BrowserPanelState } from "@zhiyin/contract";
import { BrowserPanel } from "./BrowserPanel.js";

const openPage: BrowserPanelState = {
  status: "open",
  url: "https://example.com/docs",
  title: "Docs",
  loading: false,
  frame: { data: "AAAA", width: 800, height: 600 },
};

/** The panel draws at whatever width the rail gives it; tests need a size. */
function sizeTheView(width = 400, height = 300) {
  vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect").mockReturnValue(
    {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => "",
    },
  );
}

/** The picture of the page, which takes the person's mouse and keys. */
function view(): HTMLElement {
  return screen.getByAltText("Docs — the page Zhiyin is working on");
}

/** What the panel asked of the browser, in order. */
function sent(onDrive: { mock: { calls: unknown[][] } }): unknown[] {
  return onDrive.mock.calls.map(([intent]) => intent);
}

/** A left-button step at a point of the page, with no key held. */
function leftAt(x: number, y: number) {
  return {
    kind: "pointer",
    x,
    y,
    button: "left",
    clicks: 1,
    keys: [],
  } as const;
}

describe("BrowserPanel", () => {
  it("draws nothing at all when no browser is open", () => {
    const { container } = render(
      <BrowserPanel
        browser={{ status: "closed", url: "", title: "", loading: false }}
        onDrive={() => undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the page it is on", () => {
    render(<BrowserPanel browser={openPage} onDrive={() => undefined} />);

    expect(screen.getByLabelText("Zhiyin's browser")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Docs" })).toBeVisible();
    expect(screen.getByLabelText("Address")).toHaveValue(
      "https://example.com/docs",
    );
    expect(
      screen.getByAltText("Docs — the page Zhiyin is working on"),
    ).toHaveAttribute("src", "data:image/jpeg;base64,AAAA");
  });

  it("never lets the page's picture be dragged out of the panel", () => {
    render(<BrowserPanel browser={openPage} onDrive={() => undefined} />);

    const dragged = fireEvent.dragStart(
      screen.getByAltText("Docs — the page Zhiyin is working on"),
    );

    expect(dragged).toBe(false);
  });

  it("sends a click as a press and a release in the page's coordinates, not the panel's", async () => {
    const onDrive = vi.fn();
    sizeTheView(400, 300);
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.mouseDown(view(), { clientX: 100, clientY: 150, detail: 1 });
    fireEvent.mouseUp(window, { clientX: 100, clientY: 150, detail: 1 });

    // Drawn at half size, so the middle of the panel is the middle of the page.
    await waitFor(() =>
      expect(sent(onDrive)).toEqual([
        { ...leftAt(200, 300), action: "press" },
        { ...leftAt(200, 300), action: "release" },
      ]),
    );
  });

  it("sends a drag as it goes, held to the page's edge past the picture, and lets go where the button comes up", async () => {
    const onDrive = vi.fn();
    sizeTheView(400, 300);
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.mouseDown(view(), { clientX: 10, clientY: 10, detail: 1 });
    await waitFor(() => expect(onDrive).toHaveBeenCalledTimes(1));
    fireEvent.mouseMove(window, { clientX: 50, clientY: 10 });
    await waitFor(() => expect(onDrive).toHaveBeenCalledTimes(2));
    // Out past the picture's right edge, as a slider dragged to its end.
    fireEvent.mouseMove(window, { clientX: 900, clientY: 10, shiftKey: true });
    await waitFor(() => expect(onDrive).toHaveBeenCalledTimes(3));
    fireEvent.mouseUp(window, { clientX: 900, clientY: 10, detail: 1 });

    await waitFor(() =>
      expect(sent(onDrive)).toEqual([
        { ...leftAt(20, 20), action: "press" },
        { ...leftAt(100, 20), action: "move", clicks: 0 },
        { ...leftAt(799, 20), action: "move", clicks: 0, keys: ["Shift"] },
        { ...leftAt(799, 20), action: "release" },
      ]),
    );
    // Once the button is up, the window's moves are no longer the page's.
    fireEvent.mouseMove(window, { clientX: 60, clientY: 10 });
    await new Promise((settle) => setTimeout(settle, 0));
    expect(onDrive).toHaveBeenCalledTimes(4);
  });

  it("counts the clicks of a double click, and sends the right button for the page's own menu", async () => {
    const onDrive = vi.fn();
    sizeTheView(400, 300);
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.mouseDown(view(), { clientX: 5, clientY: 5, detail: 1 });
    fireEvent.mouseUp(window, { clientX: 5, clientY: 5, detail: 1 });
    fireEvent.mouseDown(view(), { clientX: 5, clientY: 5, detail: 2 });
    fireEvent.mouseUp(window, { clientX: 5, clientY: 5, detail: 2 });
    fireEvent.mouseDown(view(), {
      clientX: 5,
      clientY: 5,
      button: 2,
      detail: 1,
    });
    fireEvent.mouseUp(window, { clientX: 5, clientY: 5, button: 2, detail: 1 });
    const menu = fireEvent.contextMenu(view(), { clientX: 5, clientY: 5 });

    await waitFor(() =>
      expect(sent(onDrive)).toEqual([
        { ...leftAt(10, 10), action: "press" },
        { ...leftAt(10, 10), action: "release" },
        { ...leftAt(10, 10), action: "press", clicks: 2 },
        { ...leftAt(10, 10), action: "release", clicks: 2 },
        { ...leftAt(10, 10), action: "press", button: "right" },
        { ...leftAt(10, 10), action: "release", button: "right" },
      ]),
    );
    // The window shows no menu of its own over the page.
    expect(menu).toBe(false);
  });

  it("lets the page see the pointer hover, sending only where it is now once the page is ready for more", async () => {
    let landed: () => void = () => {};
    const onDrive = vi.fn(
      () => new Promise<void>((land) => (landed = () => land())),
    );
    sizeTheView(400, 300);
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.mouseMove(view(), { clientX: 1, clientY: 1 });
    // The page has not taken the first yet: these wait, and only the last
    // place counts.
    fireEvent.mouseMove(view(), { clientX: 2, clientY: 2 });
    fireEvent.mouseMove(view(), { clientX: 3, clientY: 3 });
    landed();

    await waitFor(() => expect(onDrive).toHaveBeenCalledTimes(2));
    expect(sent(onDrive)).toEqual([
      { kind: "pointer", action: "move", x: 2, y: 2, clicks: 0, keys: [] },
      { kind: "pointer", action: "move", x: 6, y: 6, clicks: 0, keys: [] },
    ]);
  });

  it("sends the wheel both ways, sideways with Shift held, adding up turns that wait", async () => {
    let landed: () => void = () => {};
    const onDrive = vi.fn(
      () => new Promise<void>((land) => (landed = () => land())),
    );
    sizeTheView(400, 300);
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.wheel(view(), { clientX: 10, clientY: 10, deltaY: 100 });
    fireEvent.wheel(view(), { clientX: 10, clientY: 10, deltaX: 30 });
    fireEvent.wheel(view(), {
      clientX: 10,
      clientY: 10,
      deltaY: 50,
      shiftKey: true,
    });
    landed();

    await waitFor(() => expect(onDrive).toHaveBeenCalledTimes(2));
    expect(sent(onDrive)).toEqual([
      { kind: "scroll", x: 20, y: 20, deltaX: 0, deltaY: 100 },
      { kind: "scroll", x: 20, y: 20, deltaX: 80, deltaY: 0 },
    ]);
  });

  it("sends printable keys as text and control keys as keys", async () => {
    const onDrive = vi.fn();
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.keyDown(view(), { key: "h" });
    fireEvent.keyDown(view(), { key: "Enter" });
    fireEvent.keyDown(view(), { key: "ArrowDown" });

    await waitFor(() =>
      expect(sent(onDrive)).toEqual([
        { kind: "type", text: "h" },
        { kind: "key", key: "Enter" },
        { kind: "key", key: "ArrowDown" },
      ]),
    );
  });

  it("sends a control key with Shift held as pressed, and a character outside the basic plane whole", async () => {
    const onDrive = vi.fn();
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.keyDown(view(), { key: "Tab", shiftKey: true });
    fireEvent.keyDown(view(), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(view(), { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyDown(view(), { key: "H", shiftKey: true });
    fireEvent.keyDown(view(), { key: "😀" });

    await waitFor(() =>
      expect(sent(onDrive)).toEqual([
        { kind: "key", key: "Shift+Tab" },
        { kind: "key", key: "Shift+Enter" },
        { kind: "key", key: "Shift+ArrowLeft" },
        { kind: "type", text: "H" },
        { kind: "type", text: "😀" },
      ]),
    );
  });

  it("asks for the page's selection on Ctrl+C and Ctrl+X, after what was done before them", async () => {
    const onDrive = vi.fn();
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.keyDown(view(), { key: "a", ctrlKey: true });
    fireEvent.keyDown(view(), { key: "c", ctrlKey: true });
    fireEvent.keyDown(view(), { key: "x", ctrlKey: true });

    await waitFor(() =>
      expect(sent(onDrive)).toEqual([
        { kind: "key", key: "Control+a" },
        { kind: "copy" },
        { kind: "cut" },
      ]),
    );
  });

  it("lets the keyboard leave the page with F6, and says so", () => {
    const onDrive = vi.fn();
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);
    const view = screen.getByAltText("Docs — the page Zhiyin is working on");
    view.focus();

    fireEvent.keyDown(view, { key: "F6" });

    expect(screen.getByRole("textbox", { name: "Address" })).toHaveFocus();
    expect(onDrive).not.toHaveBeenCalled();
    expect(view).toHaveAccessibleDescription(/F6 moves to the address\.$/);
  });

  it("sends pasted text to the page", () => {
    const onDrive = vi.fn();
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.paste(
      screen.getByAltText("Docs — the page Zhiyin is working on"),
      { clipboardData: { getData: () => "12 Rue de la Paix, Paris" } },
    );

    expect(onDrive).toHaveBeenCalledWith({
      kind: "type",
      text: "12 Rue de la Paix, Paris",
    });
  });

  it("sends a long paste whole, in pieces the core takes, never splitting a character", async () => {
    const onDrive = vi.fn<(intent: BrowserIntent) => Promise<void>>(
      async () => undefined,
    );
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);
    const text = "a".repeat(9_999) + "😀" + "b".repeat(5_000);

    fireEvent.paste(
      screen.getByAltText("Docs — the page Zhiyin is working on"),
      { clipboardData: { getData: () => text } },
    );

    await waitFor(() => expect(onDrive).toHaveBeenCalledTimes(2));
    const sent = onDrive.mock.calls.map(
      ([intent]) => (intent as { text: string }).text,
    );
    expect(sent.join("")).toBe(text);
    for (const piece of sent) {
      expect(piece.length).toBeLessThanOrEqual(10_000);
      expect(piece).not.toMatch(/[\uD800-\uDBFF]$/);
    }
  });

  it("sends select all, undo and redo to the page as the shortcuts they are", async () => {
    const onDrive = vi.fn();
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.keyDown(view(), { key: "a", ctrlKey: true });
    fireEvent.keyDown(view(), { key: "z", ctrlKey: true });
    fireEvent.keyDown(view(), { key: "y", ctrlKey: true });
    fireEvent.keyDown(view(), { key: "Z", ctrlKey: true, shiftKey: true });

    await waitFor(() =>
      expect(sent(onDrive)).toEqual([
        { kind: "key", key: "Control+a" },
        { kind: "key", key: "Control+z" },
        { kind: "key", key: "Control+y" },
        { kind: "key", key: "Control+Shift+Z" },
      ]),
    );
  });

  it("leaves the application's shortcuts, and Ctrl keys the page is not sent, to the application", async () => {
    const onDrive = vi.fn();
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.keyDown(view(), { key: "n", ctrlKey: true });
    fireEvent.keyDown(view(), { key: ",", ctrlKey: true });
    fireEvent.keyDown(view(), { key: "C", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(view(), { key: "a", ctrlKey: true, altKey: true });
    await new Promise((settle) => setTimeout(settle, 0));

    expect(onDrive).not.toHaveBeenCalled();
  });

  it("says nothing on screen about the page, and tells a screen reader only how the keyboard leaves it", () => {
    const { container } = render(
      <BrowserPanel browser={openPage} onDrive={() => undefined} />,
    );

    expect(view()).toHaveAccessibleDescription(
      "Keys go to the page. F6 moves to the address.",
    );
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("opens the page in the person's own browser when asked", () => {
    const onOpenOutside = vi.fn();
    render(
      <BrowserPanel
        browser={openPage}
        onDrive={() => undefined}
        onOpenOutside={onOpenOutside}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open in your browser" }),
    );

    expect(onOpenOutside).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("offers no outside browser for a page with no web address", () => {
    render(
      <BrowserPanel
        browser={{ ...openPage, url: "data:text/html,<p>Hi</p>" }}
        onDrive={() => undefined}
        onOpenOutside={() => undefined}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Open in your browser" }),
    ).toBeNull();
  });

  it("navigates to a typed address and keeps what was typed until it lands", () => {
    const onDrive = vi.fn();
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);
    const address = screen.getByLabelText("Address");

    fireEvent.change(address, {
      target: { value: "https://example.com/next" },
    });
    expect(address).toHaveValue("https://example.com/next");
    fireEvent.submit(address);

    expect(onDrive).toHaveBeenCalledWith({
      kind: "navigate",
      url: "https://example.com/next",
    });
  });

  it("moves through history and reloads", () => {
    const onDrive = vi.fn();
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    fireEvent.click(screen.getByRole("button", { name: "Close browser" }));

    expect(onDrive.mock.calls.map(([intent]) => intent.kind)).toEqual([
      "back",
      "forward",
      "reload",
      "close",
    ]);
  });

  it("says why the browser is unusable rather than showing an empty frame", () => {
    render(
      <BrowserPanel
        browser={{
          status: "failed",
          url: "",
          title: "",
          loading: false,
          reason: "No supported browser could be started.",
        }}
        onDrive={() => undefined}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No supported browser could be started.",
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("says plainly that no browser window opened, and tries again when asked", () => {
    const onDrive = vi.fn();
    render(
      <BrowserPanel
        browser={{
          status: "failed",
          url: "",
          title: "",
          loading: false,
          reason:
            "The browser could not be opened. No supported browser is installed. Tried Microsoft Edge and Google Chrome.",
        }}
        onDrive={onDrive}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Zhiyin could not open a browser window.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onDrive).toHaveBeenCalledWith({ kind: "open" });
  });

  it("says which page it is opening while it waits for the first picture", () => {
    render(
      <BrowserPanel
        browser={{
          status: "opening",
          url: "https://docs.zhiyin.app/guide",
          title: "",
          loading: true,
        }}
        onDrive={() => undefined}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Opening docs.zhiyin.app…",
    );
  });

  it("offers no controls for a page it cannot reach yet", () => {
    render(
      <BrowserPanel
        browser={{ status: "opening", url: "", title: "", loading: true }}
        onDrive={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByLabelText("Address")).toBeDisabled();
    expect(screen.getByText("Loading…")).toBeVisible();
  });

  it("does not show a data URL as if it were an address", () => {
    render(
      <BrowserPanel
        browser={{ ...openPage, url: "data:text/html,%3Ch1%3EHi" }}
        onDrive={() => undefined}
      />,
    );

    expect(screen.getByLabelText("Address")).toHaveValue("Untitled page");
  });
});
