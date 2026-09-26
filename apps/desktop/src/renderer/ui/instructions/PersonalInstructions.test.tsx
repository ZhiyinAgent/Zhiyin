import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PersonalInstructions } from "./PersonalInstructions.js";

function editor(saved = "", onSave = vi.fn(async () => {})) {
  render(<PersonalInstructions saved={saved} onSave={onSave} />);
  return {
    onSave,
    field: screen.getByRole("textbox", { name: "Your instructions" }),
    save: screen.getByRole("button", { name: "Save instructions" }),
  };
}

describe("the person's own instructions in Settings", () => {
  it("shows what is saved, and saves an edit", async () => {
    const { field, save, onSave } = editor("Always answer in French.");

    expect(field).toHaveValue("Always answer in French.");
    expect(save).toBeDisabled();
    fireEvent.change(field, { target: { value: "Answer in German." } });
    fireEvent.click(save);

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("Answer in German."),
    );
    expect(screen.getByText(/never grant permission/i)).toBeVisible();
  });

  it("can clear them", async () => {
    const { field, save, onSave } = editor("Always answer in French.");

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(save);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(""));
  });

  it("counts the size and says when only the first 16 KB will be sent", () => {
    const { field } = editor();

    fireEvent.change(field, { target: { value: "é".repeat(9_000) } });

    expect(screen.getByText("18 KB of 16 KB")).toBeVisible();
    expect(
      screen.getByText(/only the first 16 KB will be sent/i),
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
