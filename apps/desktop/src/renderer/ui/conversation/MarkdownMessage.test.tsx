import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpenCitation } from "./citation.js";
import { MarkdownMessage } from "./MarkdownMessage.js";

const answer =
  "Riverside had **38,612 visits** ([page 24](annual-report-2025.pdf#page=24)). See also [the chart](charts/visits.png) and [the council](https://example.com/council).";

function rendered(open?: (path: string, page?: number) => void) {
  return render(
    open ? (
      <OpenCitation.Provider value={open}>
        <MarkdownMessage>{answer}</MarkdownMessage>
      </OpenCitation.Provider>
    ) : (
      <MarkdownMessage>{answer}</MarkdownMessage>
    ),
  );
}

describe("a citation in an answer (ADR 0018)", () => {
  it("opens its document at its page when clicked, named by both", () => {
    const open = vi.fn();
    rendered(open);

    fireEvent.click(
      screen.getByRole("button", {
        name: "page 24, opens annual-report-2025.pdf at page 24",
      }),
    );

    expect(open).toHaveBeenCalledWith("annual-report-2025.pdf", 24);
  });

  it("opens a picture it cites, with no page", () => {
    const open = vi.fn();
    rendered(open);

    fireEvent.click(
      screen.getByRole("button", { name: "the chart, opens visits.png" }),
    );

    expect(open).toHaveBeenCalledWith("charts/visits.png", undefined);
  });

  // A native button: the keyboard reaches it and Enter or Space presses it.
  // Pressing is checked by hand in the lab; jsdom does not turn keys into clicks.
  it("is a button the keyboard reaches, and never a link that navigates", () => {
    rendered(vi.fn());
    const citation = screen.getByRole("button", { name: /^page 24/ });

    citation.focus();

    expect(citation).toHaveFocus();
    expect(citation.tagName).toBe("BUTTON");
    expect(citation).toHaveAttribute("type", "button");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("leaves a web link as it was: its address beside it, and nothing to press", () => {
    rendered(vi.fn());

    expect(screen.getByText(/https:\/\/example\.com\/council/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /the council/ })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("is plain text where nothing can open it", () => {
    rendered();

    expect(screen.getByText("page 24")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
