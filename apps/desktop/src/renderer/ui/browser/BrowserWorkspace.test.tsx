import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BrowserPanelState } from "@zhiyin/contract";
import { BrowserWorkspace } from "./BrowserWorkspace.js";

const browser: BrowserPanelState = {
  status: "open",
  title: "Preview",
  url: "https://example.com",
  loading: false,
  frame: { data: "frame", width: 1280, height: 800 },
};

describe("BrowserWorkspace", () => {
  it("retains the user-selected divider position across updates and layout switches", () => {
    const onDrive = vi.fn();
    const props = {
      browser,
      split: true,
      id: "workspace",
      onDrive,
      onReturn: () => undefined,
      children: <p>Conversation</p>,
    };
    const { rerender } = render(<BrowserWorkspace {...props} />);
    const divider = screen.getByRole("separator", {
      name: "Resize browser and conversation",
    });
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "65");
    rerender(
      <BrowserWorkspace
        {...props}
        browser={{ ...browser, frame: { ...browser.frame!, data: "next" } }}
        children={<p>Approval needed</p>}
      />,
    );
    expect(divider).toHaveAttribute("aria-valuenow", "65");
    rerender(<BrowserWorkspace {...props} split={false} />);
    expect(screen.queryByRole("separator")).toBeNull();
    rerender(<BrowserWorkspace {...props} />);
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-valuenow",
      "65",
    );
    fireEvent.keyDown(divider, { key: "Home" });
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "35");
    fireEvent.doubleClick(divider);
    expect(divider).toHaveAttribute("aria-valuenow", "70");
    expect(onDrive).not.toHaveBeenCalled();
  });

  it("retains the last frame only for the closing transition and disables its controls", () => {
    vi.useFakeTimers();
    try {
      const props = {
        browser,
        split: true,
        id: "workspace",
        onDrive: vi.fn(),
        onReturn: () => undefined,
        children: <input aria-label="Draft" defaultValue="Keep this" />,
      };
      const { rerender } = render(<BrowserWorkspace {...props} />);
      const frame = screen.getByRole("img", { name: /Preview — the page/ });
      rerender(
        <BrowserWorkspace
          {...props}
          split={false}
          browser={{ status: "closed", title: "", url: "", loading: false }}
        />,
      );
      expect(frame).toBeInTheDocument();
      expect(frame.closest("[inert]")).not.toBeNull();
      expect(
        screen.queryByRole("img", { name: /Preview — the page/ }),
      ).toBeNull();
      expect(screen.getByLabelText("Draft")).toHaveValue("Keep this");
      act(() => vi.advanceTimersByTime(220));
      expect(frame).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a return after a browser failure without treating it as a completed task", () => {
    const onReturn = vi.fn();
    render(
      <BrowserWorkspace
        browser={{
          status: "failed",
          title: "",
          url: "",
          loading: false,
          reason: "Browser disconnected",
        }}
        split
        id="workspace"
        onDrive={() => undefined}
        onReturn={onReturn}
      >
        <p>Still working</p>
      </BrowserWorkspace>,
    );
    expect(screen.getByText("Browser disconnected")).toBeVisible();
    expect(screen.getByText("Still working")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Return to conversation" }),
    );
    expect(onReturn).toHaveBeenCalledOnce();
  });
});
