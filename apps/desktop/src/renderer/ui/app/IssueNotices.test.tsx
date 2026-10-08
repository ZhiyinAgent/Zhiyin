import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueNotices } from "./IssueNotices.js";

const damaged = {
  message:
    "“Rapport enseignement en maternelle” is damaged and can't be opened. Your other conversations are unaffected.",
  keptAt:
    "C:\\Users\\someone\\AppData\\Roaming\\desktop\\damaged-history\\history-2026-09-30T14-45-09-023Z",
  conversationId: "task-7",
  canDelete: true as const,
};

describe("IssueNotices", () => {
  it("shows a damaged conversation's report with where its copy was kept set apart, and deletes or dismisses it", () => {
    const onDelete = vi.fn();
    const onDismiss = vi.fn();
    render(
      <IssueNotices
        issues={[damaged]}
        openConversationId="task-7"
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

  it("shows only what concerns the open conversation, beside what concerns none", () => {
    const other = {
      message:
        "“Budget 2026” is damaged and can't be opened. Your other conversations are unaffected.",
      conversationId: "task-8",
      canDelete: true as const,
    };
    const general = {
      message:
        "Plugins could not be refreshed. What is shown may be out of date.",
    };

    render(
      <IssueNotices
        issues={[damaged, other, general]}
        openConversationId="task-8"
      />,
    );

    expect(
      screen.getAllByRole("alert").map((notice) => notice.textContent),
    ).toEqual([
      expect.stringContaining(other.message),
      expect.stringContaining(general.message),
    ]);
  });

  it("offers to delete only a conversation that cannot be opened", () => {
    render(
      <IssueNotices
        issues={[
          {
            message:
              "The folder for “Budget 2026” could not be opened. Choose its new location before using files.",
            conversationId: "task-8",
          },
        ]}
        openConversationId="task-8"
        onDelete={() => undefined}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Delete conversation" }),
    ).toBeNull();
  });

  it("shows the kept copy in its folder when asked", () => {
    const onShowKept = vi.fn();
    render(
      <IssueNotices
        issues={[damaged]}
        openConversationId="task-7"
        onShowKept={onShowKept}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));

    expect(onShowKept).toHaveBeenCalledWith(damaged.keptAt);
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
