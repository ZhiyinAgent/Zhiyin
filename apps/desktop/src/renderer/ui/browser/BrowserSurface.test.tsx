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
