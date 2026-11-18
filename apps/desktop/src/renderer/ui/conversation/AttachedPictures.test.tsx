import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MessageAttachment } from "@zhiyin/contract";
import { UserTurn } from "./ConversationTimeline.js";

describe("pictures on a sent message", () => {
  const attached: MessageAttachment = {
    kind: "picture",
    id: "picture-1",
    name: "screenshot.png",
    mediaType: "image/png",
    bytes: 4,
    source: "pasted-pictures/c-task/picture-1",
  };

  it("shows each one small, and opens it full size", async () => {
    render(
      <UserTurn
        text="What is this?"
        attachments={[attached]}
        readPicture={async () => ({
          status: "ready",
          mediaType: "image/png",
          data: "iVBORw==",
        })}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open picture screenshot.png",
      }),
    );

    const viewer = screen.getByRole("dialog", { name: "screenshot.png" });
    expect(viewer).toBeVisible();
    expect(
      within(viewer).getByRole("heading", { name: "screenshot.png" }),
    ).toBeVisible();

    fireEvent.click(within(viewer).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says why one is gone once it is no longer stored", async () => {
    render(
      <UserTurn
        text="What is this?"
        attachments={[attached]}
        readPicture={async () => ({
          status: "missing",
          reason: "This picture was deleted to save disk space.",
        })}
      />,
    );

    expect(
      await screen.findByText(
        "screenshot.png: This picture was deleted to save disk space.",
      ),
    ).toBeVisible();
  });
});
