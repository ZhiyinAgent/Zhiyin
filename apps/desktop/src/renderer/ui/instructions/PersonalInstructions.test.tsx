import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PersonalInstructions } from "./PersonalInstructions.js";
import { InstructionsSettings } from "./InstructionsSettings.js";

function editor(saved = "", onSave = vi.fn(async () => {})) {
  render(<PersonalInstructions saved={saved} onSave={onSave} />);
  return {
    onSave,
    field: screen.getByRole("textbox", { name: "Your instructions" }),
    save: screen.getByRole("button", { name: "Save instructions" }),
  };
}

describe("the person's own instructions in Custom instructions", () => {
  it("keeps the editor and guidance together on the dedicated page", () => {
    const onClose = vi.fn();
    render(
      <InstructionsSettings
        saved="Reply in French."
        onSave={async () => undefined}
        onClose={onClose}
      />,
    );

    const page = screen.getByRole("region", { name: "Custom instructions" });
    expect(page).toContainElement(
      screen.getByRole("textbox", { name: "Your instructions" }),
    );
    expect(screen.getByText("Make it specific")).toBeVisible();
    expect(screen.getByText(/never approve an action for you/i)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Close custom instructions" }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows what is saved, and saves an edit", async () => {
    const { field, save, onSave } = editor("Always answer in French.");

    expect(field).toHaveValue("Always answer in French.");
    expect(save).toBeDisabled();
    fireEvent.change(field, { target: { value: "Answer in German." } });
    fireEvent.click(save);

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("Answer in German."),
    );
    expect(screen.getByText(/edit these at any time/i)).toBeVisible();
  });

  it("can clear them", async () => {
    const { field, save, onSave } = editor("Always answer in French.");

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(save);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(""));
  });

  /** Bytes mean nothing to most people; words do, and a share of the space does in any script. */
  it("counts the words and the share of the space they take, and says when the end will be cut", () => {
    const { field } = editor();

    fireEvent.change(field, {
      target: { value: "Reply in French. Keep explanations concise." },
    });
    expect(screen.getByText("6 words · under 1% of the space")).toBeVisible();

    fireEvent.change(field, { target: { value: "word ".repeat(4_000) } });
    expect(screen.getByText("4,000 words · 122% of the space")).toBeVisible();
    expect(
      screen.getByText("Only about the first 3,277 words will be sent."),
    ).toBeVisible();
  });

  it("says when the save failed and keeps the edit", async () => {
    const { field, save } = editor(
      "",
      vi.fn(async () => {
        throw new Error("disk full");
      }),
    );

    fireEvent.change(field, { target: { value: "Be brief." } });
    fireEvent.click(save);

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(field).toHaveValue("Be brief.");
  });
});
