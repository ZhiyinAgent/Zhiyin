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

describe("a citation in an answer (ADR 0023)", () => {
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

  it("keeps the dash before a web address on the address's line", () => {
    rendered(vi.fn());

    expect(
      screen.getByText(/https:\/\/example\.com\/council/).textContent,
    ).toContain("— https://example.com/council");
  });

  it.each([
    ["a bare address", "See https://example.com/council for details."],
    ["an autolink", "See <https://example.com/council> for details."],
    ["an address starting www.", "See www.example.com/council for details."],
    ["a site's bare name", "See www.example.com for details."],
    [
      "a link whose words leave out the www.",
      "See [example.com](https://www.example.com/) for details.",
    ],
  ])("gives %s once, with no dash", (_, text) => {
    const { container } = render(<MarkdownMessage>{text}</MarkdownMessage>);

    const said = container.textContent ?? "";
    expect(said.match(/example\.com/g)).toHaveLength(1);
    expect(said).not.toContain("—");
  });

  it.each([
    ["Chinese in its path", "见 https://zh.wikipedia.org/wiki/知音 。", "知音"],
    ["an accent in its path", "See https://example.com/über for it.", "über"],
    ["an accent in its name", "See https://bücher.de for it.", "bücher"],
  ])("gives an address with %s once, as it was written", (_, text, part) => {
    const { container } = render(<MarkdownMessage>{text}</MarkdownMessage>);

    const said = container.textContent ?? "";
    expect(said.split(part)).toHaveLength(2);
    expect(said).not.toContain("—");
    expect(said).not.toMatch(/%[0-9A-F]{2}|xn--/);
  });

  it("is plain text where nothing can open it", () => {
    rendered();

    expect(screen.getByText("page 24")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("a picture an answer names", () => {
  // An answer is the model's text, and an address in it is the model's
  // choice: drawing it would make the window fetch whatever it names.
  it.each([
    ["a network share", "![chart](//files.example/share/chart.png)"],
    ["a file on this computer", "![chart](file:///C:/Users/me/chart.png)"],
    ["a relative path", "![chart](../../chart.png)"],
    ["a web address", "![chart](https://example.com/chart.png)"],
  ])("loads nothing from %s, and keeps its words", (_kind, text) => {
    const { container } = render(<MarkdownMessage>{text}</MarkdownMessage>);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("chart")).toBeVisible();
  });
});
