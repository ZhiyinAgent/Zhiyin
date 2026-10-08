import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  MessageAttachment,
  PasteOutcome,
  PictureToKeep,
} from "@zhiyin/contract";
import { Composer } from "./Composer.js";
import { UserTurn } from "./ConversationTimeline.js";

function png(name: string): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, {
    type: "image/png",
  });
}

/** Keeps every picture it is given, as the core does for a model that sees. */
function keeping() {
  let count = 0;
  return vi.fn(async (picture: PictureToKeep): Promise<PasteOutcome> => ({
    status: "kept",
    attachment: {
      kind: "picture",
      id: `picture-${++count}`,
      name: picture.name,
      mediaType: picture.mediaType,
      bytes: 4,
    },
  }));
}

function field() {
  return screen.getByRole("textbox", { name: "Message Zhiyin" });
}

describe("pictures in the composer", () => {
  it("takes a pasted, a dropped and a chosen picture the same way, and sends them with the message", async () => {
    const keepPicture = keeping();
    const onSubmit = vi.fn();
    const { container } = render(
      <Composer seesPictures keepPicture={keepPicture} onSubmit={onSubmit} />,
    );

    fireEvent.paste(field(), {
      clipboardData: { files: [png("image.png")], getData: () => "" },
    });
    fireEvent.drop(container.querySelector("form") as HTMLFormElement, {
      dataTransfer: { files: [png("dropped.png")], types: ["Files"] },
    });
    fireEvent.change(screen.getByLabelText("Pictures to attach"), {
      target: { files: [png("chosen.png")] },
    });

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /^Open picture / }),
      ).toHaveLength(3),
    );
    expect(keepPicture.mock.calls.map(([picture]) => picture.name)).toEqual([
      expect.stringMatching(/^pasted-\d{4}-\d{2}-\d{2}-\d{6}\.png$/),
      "dropped.png",
      "chosen.png",
    ]);
    expect(keepPicture.mock.calls[0]?.[0]).toMatchObject({
      mediaType: "image/png",
      data: "iVBORw==",
    });
    fireEvent.change(field(), { target: { value: "What is this?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith("What is this?", undefined, [
        expect.objectContaining({ id: "picture-1" }),
        expect.objectContaining({ id: "picture-2" }),
        expect.objectContaining({ id: "picture-3" }),
      ]),
    );
  });

  it("with a model that cannot see pictures, says why the button is off, and explains a pasted picture instead of dropping it", () => {
    const keepPicture = keeping();
    render(<Composer seesPictures={false} keepPicture={keepPicture} />);

    const attach = screen.getByRole("button", { name: "Attach pictures" });
    expect(attach).toBeDisabled();
    expect(attach).toHaveAccessibleDescription(
      "This model can't see pictures. Choose one that can in Model.",
    );
    fireEvent.paste(field(), {
      clipboardData: { files: [png("image.png")], getData: () => "" },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This model can't see pictures. Choose one that can, or describe what's in it.",
    );
    expect(keepPicture).not.toHaveBeenCalled();
  });

  it("refuses a ninth picture, saying how many a message can carry", async () => {
    const keepPicture = keeping();
    render(<Composer seesPictures keepPicture={keepPicture} />);

    fireEvent.change(screen.getByLabelText("Pictures to attach"), {
      target: {
        files: Array.from({ length: 9 }, (_, index) => png(`${index}.png`)),
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A message can carry at most 8 pictures.",
    );
    await waitFor(() => expect(keepPicture).toHaveBeenCalledTimes(8));
  });

  it("says a file that is not a picture it can attach was left out", async () => {
    render(<Composer seesPictures keepPicture={keeping()} />);

    fireEvent.change(screen.getByLabelText("Pictures to attach"), {
      target: {
        files: [new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })],
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "logo.svg was left out: only PNG, JPEG, GIF and WebP pictures can be attached.",
    );
  });
});

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
