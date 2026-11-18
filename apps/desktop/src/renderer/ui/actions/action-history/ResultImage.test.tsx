import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResultImage } from "./ResultImage.js";

const detail = {
  kind: "image" as const,
  label: "Picture",
  mediaType: "image/png",
  source: "picture-1",
  alt: "The chart, as Zhiyin's browser saw it",
};

const stored = async () =>
  ({ status: "ready", mediaType: "image/png", data: "AAAA" }) as const;

async function shown() {
  render(<ResultImage detail={detail} readPicture={stored} />);
  return await screen.findByRole("img", { name: detail.alt });
}

describe("a picture an action produced", () => {
  it("is fetched by name and shown as itself", async () => {
    const picture = await shown();

    expect(picture).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(screen.getByText("Picture")).toBeVisible();
  });

  it("opens to full size from the picture itself, and closes again", async () => {
    const picture = await shown();

    // Named for what it shows, then what it does.
    const opens = screen.getByRole("button", {
      name: /^The chart, as Zhiyin's browser saw it\s*,\s*see it full size$/,
    });
    expect(opens).toContainElement(picture);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(picture);
    expect(screen.getByRole("dialog")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says a picture cannot be drawn rather than leaving a broken frame", async () => {
    fireEvent.error(await shown());

    expect(screen.getByText(/could not be shown/i)).toBeVisible();
  });

  it("says so when the picture is no longer stored", async () => {
    render(
      <ResultImage
        detail={detail}
        readPicture={async () => ({
          status: "missing",
          reason: "It is no longer stored.",
        })}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/could not be shown/i)).toBeVisible(),
    );
    expect(screen.queryByRole("img")).toBeNull();
  });
});
