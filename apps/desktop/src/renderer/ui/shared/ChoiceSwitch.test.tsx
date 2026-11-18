import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChoiceSwitch } from "./ChoiceSwitch.js";

const sizes = [
  { value: "small", label: "Small" },
  { value: "large", label: "Large" },
] as const;

describe("a switch between a few choices", () => {
  it("tells of the choice made", () => {
    const onChange = vi.fn();
    render(
      <ChoiceSwitch
        aria-label="Size"
        choices={sizes}
        value="small"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Large" }));
    expect(onChange).toHaveBeenCalledWith("large");
  });

  it("switched off, still shows its choice, and takes no other", () => {
    const onChange = vi.fn();
    render(
      <ChoiceSwitch
        aria-label="Size"
        choices={sizes}
        value="small"
        onChange={onChange}
        disabled
      />,
    );

    expect(screen.getByRole("radiogroup", { name: "Size" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Small" })).toBeChecked();
    for (const choice of screen.getAllByRole("radio"))
      expect(choice).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Large" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
