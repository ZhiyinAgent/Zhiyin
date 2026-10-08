import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BrowserPanelState } from "@zhiyin/contract";
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

  it("sends a click in the page's coordinates, not the panel's", () => {
    const onDrive = vi.fn();
    sizeTheView(400, 300);
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.click(
      screen.getByAltText("Docs — the page Zhiyin is working on"),
      {
        clientX: 100,
        clientY: 150,
      },
    );

    // Drawn at half size, so the middle of the panel is the middle of the page.
    expect(onDrive).toHaveBeenCalledWith({ kind: "click", x: 200, y: 300 });
  });

  it("sends printable keys as text and control keys as keys", () => {
    const onDrive = vi.fn();
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);
    const view = screen.getByAltText("Docs — the page Zhiyin is working on");

    fireEvent.keyDown(view, { key: "h" });
    fireEvent.keyDown(view, { key: "Enter" });
    fireEvent.keyDown(view, { key: "ArrowDown" });

    expect(onDrive).toHaveBeenNthCalledWith(1, { kind: "type", text: "h" });
    expect(onDrive).toHaveBeenNthCalledWith(2, { kind: "key", key: "Enter" });
    expect(onDrive).toHaveBeenNthCalledWith(3, {
      kind: "key",
      key: "ArrowDown",
    });
  });

  it("leaves shortcuts to the application instead of sending them to the page", () => {
    const onDrive = vi.fn();
    render(<BrowserPanel browser={openPage} onDrive={onDrive} />);

    fireEvent.keyDown(
      screen.getByAltText("Docs — the page Zhiyin is working on"),
      { key: "a", ctrlKey: true },
    );

    expect(onDrive).not.toHaveBeenCalled();
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
