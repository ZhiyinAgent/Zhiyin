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
  it("says in one line what was condensed, and opens by keyboard to the summary as formatted text", () => {
    render(<CondensingCard condensing={condensed} />);

    const toggle = screen.getByRole("button", {
      name: "Earlier conversation condensed: 42 messages and 18 actions summarised, 180K → 12K tokens",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Ship the release notes.")).toBeNull();

    toggle.focus();
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("region", {
      name: "Earlier conversation condensed",
    });
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

  it("counts one of each in the singular", () => {
    render(
      <CondensingCard
        condensing={{ ...condensed, messages: 1, actions: 1, tokensAfter: 900 }}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Earlier conversation condensed: 1 message and 1 action summarised, 180K → 900 tokens",
      }),
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
        /Couldn't condense the earlier conversation: the model's answer was not a usable summary/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
