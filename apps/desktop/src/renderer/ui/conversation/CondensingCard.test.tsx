import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TaskCondensing } from "@zhiyin/contract";
import { CondensingCard } from "./CondensingCard.js";

const condensed: TaskCondensing = {
  id: "c1",
  sequence: 7,
  createdAt: "2026-09-25T09:00:00.000Z",
  targetTokens: 262_000,
  tokensBefore: 180_400,
  outcome: "condensed",
  revision: 1,
  throughMessageId: "m9",
  tokensAfter: 12_300,
  messages: 42,
  actions: 18,
  summary: [
    "## Goal",
    "",
    "Ship the release notes.",
    "",
    "## Your instructions and constraints, quoted exactly",
    "",
    "> Never touch the changelog.",
  ].join("\n"),
  carried:
    "The person's latest request, in full:\nWrite the notes.\n\nFiles changed in this conversation, newest first: notes.md",
  reread: ["notes.md", "src/release.ts"],
};

describe("the condensing card", () => {
  it("says in one plain line what happened, and opens by keyboard to the counts and the summary as formatted text", () => {
    render(<CondensingCard condensing={condensed} />);

    const toggle = screen.getByRole("button", {
      name: "Zhiyin compacted the earlier conversation to make room",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Ship the release notes.")).toBeNull();

    toggle.focus();
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("region", {
      name: "Earlier conversation compacted",
    });
    expect(
      within(details).getByText(
        "42 messages and 18 actions became the summary below: 180K → 12K tokens.",
      ),
    ).toBeVisible();
    expect(
      within(details).getByRole("heading", {
        name: "Your instructions and constraints, quoted exactly",
      }),
    ).toBeVisible();
    expect(
      within(details)
        .getByText("Never touch the changelog.")
        .closest("blockquote"),
    ).not.toBeNull();
    expect(
      within(details).getByRole("heading", { name: "Carried over by Zhiyin" }),
    ).toBeVisible();
    expect(within(details).getByText(/Write the notes\./)).toBeVisible();
    const reread = within(details).getByRole("list", {
      name: "Files read again",
    });
    expect(
      within(reread)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["notes.md", "src/release.ts"]);
    expect(details.textContent).not.toContain("## ");
  });

  it("says when it followed the provider refusing the request as too long", () => {
    const { rerender } = render(
      <CondensingCard condensing={{ ...condensed, afterRefusal: true }} />,
    );
    expect(
      screen.getByRole("button", {
        name: "Zhiyin compacted the earlier conversation to make room, after the provider said it was too long",
      }),
    ).toBeVisible();

    rerender(
      <CondensingCard
        condensing={{
          id: "c2",
          sequence: 8,
          createdAt: "2026-09-25T09:00:00.000Z",
          targetTokens: 5_000,
          tokensBefore: 8_000,
          outcome: "failed",
          reason: "too-large",
          afterRefusal: true,
        }}
      />,
    );
    expect(
      screen.getByText(
        "Zhiyin could not compact the earlier conversation, after the provider said it was too long. It will try again later.",
      ),
    ).toBeVisible();
  });

  it("counts one of each in the singular", () => {
    render(
      <CondensingCard
        condensing={{ ...condensed, messages: 1, actions: 1, tokensAfter: 900 }}
      />,
    );
    fireEvent.click(screen.getByRole("button"));

    expect(
      screen.getByText(
        "1 message and 1 action became the summary below: 180K → 900 tokens.",
      ),
    ).toBeVisible();
  });

  it("shows a failed condensing as the same card, with its reason and nothing to open", () => {
    render(
      <CondensingCard
        condensing={{
          id: "c2",
          sequence: 7,
          createdAt: "2026-09-25T09:00:00.000Z",
          targetTokens: 13_600,
          tokensBefore: 14_200,
          outcome: "failed",
          reason: "unusable",
        }}
      />,
    );

    expect(
      screen.getByText(
        "Zhiyin could not compact the earlier conversation. It will try again later.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Why: the model's answer was not a usable summary."),
    ).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
