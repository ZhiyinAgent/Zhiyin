import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SurfaceSwitch } from "./SurfaceSwitch.js";
import { WorkspaceNotice } from "./WorkspaceNotice.js";
import { WorkspaceSplit } from "./WorkspaceSplit.js";

type Shown = { readonly name: string };
const first: Shown = { name: "First surface" };
const surface = (shown: Shown) => <p>{shown.name}</p>;

describe("WorkspaceSplit", () => {
  it("retains the divider position the person chose across updates and layout switches", () => {
    const props = {
      split: true,
      id: "workspace",
      shows: first,
      render: surface,
      children: <p>Conversation</p>,
    };
    const { rerender } = render(<WorkspaceSplit {...props} />);
    const divider = screen.getByRole("separator", {
      name: "Resize workspace and conversation",
    });
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "65");
    rerender(
      <WorkspaceSplit {...props} shows={{ name: "Next" }}>
        <p>Approval needed</p>
      </WorkspaceSplit>,
    );
    expect(divider).toHaveAttribute("aria-valuenow", "65");
    rerender(<WorkspaceSplit {...props} split={false} />);
    expect(screen.queryByRole("separator")).toBeNull();
    rerender(<WorkspaceSplit {...props} />);
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-valuenow",
      "65",
    );
    fireEvent.keyDown(divider, { key: "Home" });
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "35");
    fireEvent.doubleClick(divider);
    expect(divider).toHaveAttribute("aria-valuenow", "70");
  });

  it("keeps a width the person chose for each layout apart, and gives each back", () => {
    const props = {
      split: true,
      id: "workspace",
      shows: first,
      render: surface,
      children: <p>Conversation</p>,
    };
    const { rerender } = render(<WorkspaceSplit {...props} layout="wide" />);
    const divider = screen.getByRole("separator");
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "65");

    rerender(<WorkspaceSplit {...props} layout="tall" />);
    expect(divider).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(divider, { key: "Home" });
    expect(divider).toHaveAttribute("aria-valuenow", "35");

    rerender(<WorkspaceSplit {...props} layout="wide" />);
    expect(divider).toHaveAttribute("aria-valuenow", "65");
    rerender(<WorkspaceSplit {...props} layout="tall" />);
    expect(divider).toHaveAttribute("aria-valuenow", "35");
  });

  it("sizes its lane as the surface asks, until the person chooses a width, and returns to it on reset", () => {
    let lane: { resizeBy: (change: number) => void } | undefined;
    render(
      <WorkspaceSplit
        split
        id="workspace"
        shows={first}
        layout="tall"
        render={(shown, given) => {
          lane = given;
          return surface(shown);
        }}
      >
        <p>Conversation</p>
      </WorkspaceSplit>,
    );
    // Laid out as a browser would: the area 1,000 wide, the lane at 700.
    const area = screen.getByRole("tabpanel");
    area.getBoundingClientRect = () => new DOMRect(0, 0, 1_000, 600);
    const laneElement =
      screen.getByText("First surface").parentElement!.parentElement!;
    Object.defineProperty(laneElement, "offsetWidth", { value: 700 });
    const divider = screen.getByRole("separator");

    act(() => lane!.resizeBy(-240));
    expect(divider).toHaveAttribute("aria-valuenow", "46");

    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(divider).toHaveAttribute("aria-valuenow", "51");
    act(() => lane!.resizeBy(-240));
    expect(divider).toHaveAttribute("aria-valuenow", "51");

    fireEvent.doubleClick(divider);
    expect(divider).toHaveAttribute("aria-valuenow", "46");
  });

  it("keeps what it last showed only for the closing transition, inert, and keeps the conversation", () => {
    vi.useFakeTimers();
    try {
      const props = {
        split: true,
        id: "workspace",
        render: surface,
        children: <input aria-label="Draft" defaultValue="Keep this" />,
      };
      const { rerender } = render(<WorkspaceSplit {...props} shows={first} />);
      const shown = screen.getByText("First surface");
      rerender(<WorkspaceSplit {...props} split={false} shows={undefined} />);
      expect(shown).toBeInTheDocument();
      expect(shown.closest("[inert]")).not.toBeNull();
      expect(screen.getByLabelText("Draft")).toHaveValue("Keep this");
      act(() => vi.advanceTimersByTime(220));
      expect(shown).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts the switch between surfaces above the surface", () => {
    const onSelect = vi.fn();
    render(
      <WorkspaceSplit
        split
        id="workspace"
        shows={first}
        render={surface}
        switcher={<SurfaceSwitch selected="document" onSelect={onSelect} />}
      >
        <p>Conversation</p>
      </WorkspaceSplit>,
    );
    const browser = screen.getByRole("button", { name: "Browser" });
    expect(screen.getByRole("button", { name: "Document" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(browser).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(browser);
    expect(onSelect).toHaveBeenCalledWith("browser");
  });
});

describe("WorkspaceNotice", () => {
  it("says what is beside the conversation and shows it", () => {
    const onShow = vi.fn();
    render(
      <WorkspaceNotice text="Zhiyin is showing q3.pdf." onShow={onShow} />,
    );
    expect(screen.getByText("Zhiyin is showing q3.pdf.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show workspace" }));
    expect(onShow).toHaveBeenCalledOnce();
  });
});
