import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueNotices } from "./IssueNotices.js";

const damaged = {
  message:
    "“Rapport enseignement en maternelle” is damaged and can't be opened. Your other conversations are unaffected.",
  keptAt:
    "C:\\Users\\someone\\AppData\\Roaming\\desktop\\damaged-history\\history-2026-09-30T14-45-09-023Z",
  conversationId: "task-7",
};

describe("IssueNotices", () => {
  it("shows a damaged conversation's report with where its copy was kept set apart, and deletes or dismisses it", () => {
    const onDelete = vi.fn();
    const onDismiss = vi.fn();
    render(
      <IssueNotices
        issues={[damaged]}
        onDelete={onDelete}
        onDismiss={onDismiss}
      />,
    );

    const notice = screen.getByRole("alert");
    expect(within(notice).getByText(damaged.message)).toBeVisible();
    expect(notice).toHaveTextContent(damaged.keptAt);
    expect(within(notice).getByText(damaged.message)).not.toHaveTextContent(
      "damaged-history",
    );
    // Nothing to try again: the conversation is damaged, not unreachable.
    expect(
      within(notice).queryByRole("button", { name: "Try again" }),
    ).toBeNull();

    fireEvent.click(
      within(notice).getByRole("button", { name: "Delete conversation" }),
    );
    expect(onDelete).toHaveBeenCalledWith("task-7");
    fireEvent.click(within(notice).getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith(damaged.message);
  });

  it("offers Try again only when trying again can change something", () => {
    const retry = vi.fn();
    render(
      <IssueNotices
        issues={[{ message: "Saved history could not be opened." }]}
        retry={retry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Delete conversation" }),
    ).toBeNull();
  });
});
