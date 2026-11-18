import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer.js";

describe("Composer", () => {
  it("submits non-empty messages and clears the draft", () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} />);

    const input = screen.getByLabelText("Message Zhiyin");
    fireEvent.change(input, {
      target: { value: "Focus on the security notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith("Focus on the security notes");
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Add context" })).toBeNull();
  });

  it("explains when input is paused for a decision", () => {
    render(
      <Composer
        disabledReason="Answer the permission request first"
        disabledPlaceholder="Waiting for your decision"
      />,
    );

    expect(screen.getByLabelText("Message Zhiyin")).toBeDisabled();
    expect(screen.getByLabelText("Message Zhiyin")).toHaveAttribute(
      "placeholder",
      "Waiting for your decision",
    );
    expect(
      screen.getByText("Answer the permission request first"),
    ).toBeInTheDocument();
  });

  it("keeps Stop while a response is running, and offers to add what is typed beside it", () => {
    const onStop = vi.fn();
    render(<Composer running onStop={onStop} />);

    expect(screen.getByLabelText("Message Zhiyin")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    expect(screen.getByRole("button", { name: "Stop task" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop task" })).toHaveAttribute(
      "data-tip",
      "Stop (Esc)",
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop task" }));
    expect(onStop).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Use the newer file" },
    });
    expect(screen.getByRole("button", { name: "Stop task" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Add to current work" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Stop task" }));
    expect(onStop).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Message Zhiyin")).toHaveValue(
      "Use the newer file",
    );
  });

  it("stops a running response on Escape in the message, keeping what is typed", () => {
    const onStop = vi.fn();
    const { rerender } = render(<Composer running onStop={onStop} />);
    const field = screen.getByLabelText("Message Zhiyin");
    fireEvent.change(field, { target: { value: "No, the other folder" } });

    fireEvent.keyDown(field, { key: "Escape" });
    expect(onStop).toHaveBeenCalledOnce();
    expect(field).toHaveValue("No, the other folder");

    rerender(<Composer onStop={onStop} />);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onStop).toHaveBeenCalledOnce();
  });
});
