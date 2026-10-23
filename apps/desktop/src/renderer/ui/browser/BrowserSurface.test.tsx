import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrowserSurface } from "./BrowserSurface.js";

describe("BrowserSurface", () => {
  it("offers a return after a browser failure without treating it as a completed task", () => {
    const onReturn = vi.fn();
    render(
      <BrowserSurface
        browser={{
          status: "failed",
          title: "",
          url: "",
          loading: false,
          reason: "Browser disconnected",
        }}
        onDrive={() => undefined}
        onReturn={onReturn}
      />,
    );
    expect(screen.getByText("Browser disconnected")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Return to conversation" }),
    );
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it("says the picture's size in the screen's pixels while it is shown, and none once it is closed or the window is hidden", () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 600, height: 400 } as DOMRect);
    const density = window.devicePixelRatio;
    window.devicePixelRatio = 1.5;
    let visibility: DocumentVisibilityState = "visible";
    const visible = vi
      .spyOn(document, "visibilityState", "get")
      .mockImplementation(() => visibility);
    const onWatch = vi.fn();
    try {
      const { unmount } = render(
        <BrowserSurface
          browser={{
            status: "open",
            title: "Preview",
            url: "https://example.com",
            loading: false,
            frame: { data: "frame", width: 1280, height: 800 },
          }}
          onDrive={() => undefined}
          onWatch={onWatch}
          onReturn={() => undefined}
        />,
      );
      expect(onWatch).toHaveBeenLastCalledWith({ width: 900, height: 600 });

      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(onWatch).toHaveBeenLastCalledWith(null);
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(onWatch).toHaveBeenLastCalledWith({ width: 900, height: 600 });

      unmount();
      expect(onWatch).toHaveBeenLastCalledWith(null);
    } finally {
      spy.mockRestore();
      visible.mockRestore();
      window.devicePixelRatio = density;
    }
  });

  it("offers no return while the browser works", () => {
    render(
      <BrowserSurface
        browser={{
          status: "open",
          title: "Preview",
          url: "https://example.com",
          loading: false,
          frame: { data: "frame", width: 1280, height: 800 },
        }}
        onDrive={() => undefined}
        onReturn={() => undefined}
      />,
    );
    expect(
      screen.getByRole("img", { name: /Preview — the page/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Return to conversation" }),
    ).toBeNull();
  });
});
