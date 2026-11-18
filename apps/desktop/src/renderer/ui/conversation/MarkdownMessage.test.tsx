import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpenCitation, OpenLink } from "./citation.js";
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

describe("a citation in an answer (ADR 0019)", () => {
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

describe("a web link in an answer (ADR 0003)", () => {
  function linked(text: string, open?: (url: string) => void) {
    return render(
      open ? (
        <OpenLink.Provider value={open}>
          <MarkdownMessage>{text}</MarkdownMessage>
        </OpenLink.Provider>
      ) : (
        <MarkdownMessage>{text}</MarkdownMessage>
      ),
    );
  }

  it("opens in the browser when clicked, named by its words and its site", () => {
    const open = vi.fn();
    linked(
      "See [the council](https://www.example.com/council?year=2025).",
      open,
    );

    const link = screen.getByRole("link", { name: /the council/ });
    fireEvent.click(link);

    expect(open).toHaveBeenCalledWith(
      "https://www.example.com/council?year=2025",
    );
    // The site, not the whole address, follows the words; the whole address
    // is on the link for whoever points at it.
    expect(link.textContent).toBe("the council\u00a0· example.com");
    expect(link).toHaveAttribute(
      "title",
      "https://www.example.com/council?year=2025",
    );
  });

  it("names a site written outside ASCII as the browser will reach it", () => {
    linked("See [the shop](https://bücher.de/).", vi.fn());

    expect(screen.getByRole("link").textContent).toBe(
      "the shop\u00a0· xn--bcher-kva.de",
    );
  });

  it("gives an address that is its own words once, and opens it", () => {
    const open = vi.fn();
    linked("See https://example.com/council for details.", open);

    fireEvent.click(screen.getByRole("link"));

    expect(screen.getByRole("link").textContent).toBe(
      "https://example.com/council",
    );
    expect(open).toHaveBeenCalledWith("https://example.com/council");
  });

  it("is its words and its site where nothing can open it", () => {
    const { container } = linked("See [the council](https://example.com/c).");

    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toContain("the council\u00a0· example.com");
  });

  it.each([
    ["a file", "[the file](file:///C:/Windows/notepad.exe)"],
    ["a program's address", "[settings](ms-settings:privacy)"],
  ])("leaves a link to %s as its words, with nothing to press", (_, text) => {
    const open = vi.fn();
    linked(text, open);

    expect(screen.queryByRole("link")).toBeNull();
    expect(open).not.toHaveBeenCalled();
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

  it("opens a workspace picture beside the conversation as a citation does, loading nothing", () => {
    const open = vi.fn();
    const { container } = render(
      <OpenCitation.Provider value={open}>
        <MarkdownMessage>
          {"![the render](car/car%20render.png)"}
        </MarkdownMessage>
      </OpenCitation.Provider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "the render, opens car render.png" }),
    );

    expect(open).toHaveBeenCalledWith("car/car render.png", undefined);
    expect(container.querySelector("img")).toBeNull();
  });

  it("names a workspace picture with no words by its file", () => {
    const open = vi.fn();
    render(
      <OpenCitation.Provider value={open}>
        <MarkdownMessage>{"![](car/render.png)"}</MarkdownMessage>
      </OpenCitation.Provider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "render.png, opens render.png" }),
    );

    expect(open).toHaveBeenCalledWith("car/render.png", undefined);
  });

  it.each([
    ["a web address", "![chart](https://example.com/chart.png)"],
    ["a file on this computer", "![chart](file:///C:/Users/me/chart.png)"],
    ["a network share", "![chart](//files.example/share/chart.png)"],
    ["a path from the root", "![chart](/Users/me/chart.png)"],
    ["a path out of the folder", "![chart](../chart.png)"],
  ])(
    "keeps a picture at %s as its words, even where citations open",
    (_kind, text) => {
      render(
        <OpenCitation.Provider value={vi.fn()}>
          <MarkdownMessage>{text}</MarkdownMessage>
        </OpenCitation.Provider>,
      );

      expect(screen.getByText("chart")).toBeVisible();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    },
  );

  it("draws a workspace picture inside a link as the link's words, one control", () => {
    const open = vi.fn();
    render(
      <OpenCitation.Provider value={open}>
        <MarkdownMessage>
          {"[![the render](car/render.png)](car/side.png)"}
        </MarkdownMessage>
      </OpenCitation.Provider>,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent("the render, opens side.png");
    fireEvent.click(buttons[0]!);
    expect(open).toHaveBeenCalledWith("car/side.png", undefined);
  });

  it("keeps a workspace picture as its words where nothing can open it", () => {
    render(
      <MarkdownMessage>{"![the render](car/render.png)"}</MarkdownMessage>,
    );

    expect(screen.getByText("the render")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
