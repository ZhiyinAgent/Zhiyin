import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SurfaceSwitch } from "./SurfaceSwitch.js";
import { BesideNotice } from "./BesideNotice.js";
import { BesideSplit } from "./BesideSplit.js";

type Shown = { readonly name: string };
const first: Shown = { name: "First surface" };
const surface = (shown: Shown) => <p>{shown.name}</p>;

describe("BesideSplit", () => {
  it("retains the divider position the person chose across updates and layout switches", () => {
    const props = {
      split: true,
      id: "workspace",
      shows: first,
      render: surface,
      children: <p>Conversation</p>,
    };
    const { rerender } = render(<BesideSplit {...props} />);
    const divider = screen.getByRole("separator", {
      name: "Resize the conversation and what is beside it",
    });
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "65");
    rerender(
      <BesideSplit {...props} shows={{ name: "Next" }}>
        <p>Approval needed</p>
      </BesideSplit>,
    );
    expect(divider).toHaveAttribute("aria-valuenow", "65");
    rerender(<BesideSplit {...props} split={false} />);
    expect(screen.queryByRole("separator")).toBeNull();
    rerender(<BesideSplit {...props} />);
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
    const { rerender } = render(<BesideSplit {...props} layout="wide" />);
    const divider = screen.getByRole("separator");
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider).toHaveAttribute("aria-valuenow", "65");

    rerender(<BesideSplit {...props} layout="tall" />);
    expect(divider).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(divider, { key: "Home" });
    expect(divider).toHaveAttribute("aria-valuenow", "35");

    rerender(<BesideSplit {...props} layout="wide" />);
    expect(divider).toHaveAttribute("aria-valuenow", "65");
    rerender(<BesideSplit {...props} layout="tall" />);
    expect(divider).toHaveAttribute("aria-valuenow", "35");
  });

  it("sizes its lane as the surface asks, until the person chooses a width, and returns to it on reset", () => {
    let lane: { resizeBy: (change: number) => void } | undefined;
    render(
      <BesideSplit
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
      </BesideSplit>,
    );
    // Laid out as a browser would: the area 1,000 wide, the lane at 700.
    const area = screen.getByRole("tabpanel");
    area.getBoundingClientRect = () => new DOMRect(0, 0, 1_000, 600);
    const laneElement = area.firstElementChild!;
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
      const { rerender } = render(<BesideSplit {...props} shows={first} />);
      const shown = screen.getByText("First surface");
      rerender(<BesideSplit {...props} split={false} shows={undefined} />);
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
      <BesideSplit
        split
        id="workspace"
        shows={first}
        render={surface}
        switcher={
          <SurfaceSwitch
            available={["browser", "document"]}
            selected="document"
            onSelect={onSelect}
          />
        }
      >
        <p>Conversation</p>
      </BesideSplit>,
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

  it("keeps the surface before on screen while the next gets ready, then shows the next", () => {
    type Surface = { readonly kind: string; readonly ready: boolean };
    let readyNow: (() => void) | undefined;
    const props = {
      split: true,
      id: "workspace",
      itemOf: (shown: Surface) => shown.kind,
      waits: (shown: Surface) => shown.kind === "document",
      render: (shown: Surface, _lane: unknown, ready: () => void) => {
        if (shown.kind === "document") readyNow = ready;
        return <p>{shown.kind}</p>;
      },
      children: <p>Conversation</p>,
    };
    const { rerender } = render(
      <BesideSplit {...props} shows={{ kind: "3d", ready: true }} />,
    );

    rerender(
      <BesideSplit {...props} shows={{ kind: "document", ready: false }} />,
    );
    expect(screen.getByText("3d")).toBeVisible();
    expect(screen.getByText("document")).not.toBeVisible();

    act(() => readyNow!());
    expect(screen.queryByText("3d")).toBeNull();
    expect(screen.getByText("document")).toBeVisible();

    // A surface with nothing to get ready replaces the one shown at once.
    rerender(
      <BesideSplit {...props} shows={{ kind: "browser", ready: true }} />,
    );
    expect(screen.queryByText("document")).toBeNull();
    expect(screen.getByText("browser")).toBeVisible();
  });
});

describe("BesideNotice", () => {
  it("says what is beside the conversation and shows it, by its name", () => {
    const onShow = vi.fn();
    render(
      <BesideNotice
        text="Zhiyin is showing q3.pdf."
        surface="document"
        onShow={onShow}
      />,
    );
    expect(screen.getByText("Zhiyin is showing q3.pdf.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show the document" }));
    expect(onShow).toHaveBeenCalledOnce();
  });
});
