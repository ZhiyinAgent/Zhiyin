import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReasoningCapabilities } from "@zhiyin/contract";
import { Composer } from "./Composer.js";

const reasoning: ReasoningCapabilities = {
  status: "available",
  required: false,
  defaultEnabled: true,
  defaultEffort: "medium",
  efforts: ["low", "medium", "high"],
};

describe("Composer", () => {
  it("loads each restored draft once without overwriting later edits", () => {
    const { rerender } = render(
      <Composer draft={{ id: "rewind-1", text: "Original request" }} />,
    );
    const composer = screen.getByRole("textbox", { name: "Message Zhiyin" });
    expect(composer).toHaveValue("Original request");

    fireEvent.change(composer, { target: { value: "Edited request" } });
    rerender(<Composer draft={{ id: "rewind-1", text: "Original request" }} />);
    expect(composer).toHaveValue("Edited request");

    rerender(<Composer draft={{ id: "rewind-2", text: "Earlier request" }} />);
    expect(composer).toHaveValue("Earlier request");
  });

  it("blocks typing while a response is in progress", () => {
    const onSubmit = vi.fn();
    render(<Composer running onSubmit={onSubmit} />);

    const field = screen.getByRole("textbox", { name: "Message Zhiyin" });
    expect(field).toBeDisabled();
    expect(field).toHaveAttribute("placeholder", "Response in progress");

    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the settings and stop controls usable while a response is in progress", () => {
    const onStop = vi.fn();
    const onAddContext = vi.fn();
    render(
      <Composer
        running
        onStop={onStop}
        onAddContext={onAddContext}
        reasoningCapabilities={reasoning}
      />,
    );

    const stop = screen.getByRole("button", { name: "Stop task" });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledOnce();

    const settings = screen.getByRole("button", { name: "Reasoning settings" });
    expect(settings).toBeEnabled();
    fireEvent.click(settings);
    expect(screen.getByRole("dialog", { name: "Reasoning" })).toBeVisible();

    const addContext = screen.getByRole("button", { name: "Add context" });
    expect(addContext).toBeEnabled();
    fireEvent.click(addContext);
    expect(onAddContext).toHaveBeenCalledOnce();
  });

  it("keeps every control unavailable while the composer itself is paused", () => {
    render(
      <Composer
        disabledReason="Answer the permission request first"
        onAddContext={() => undefined}
        reasoningCapabilities={reasoning}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Message Zhiyin" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add context" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Reasoning settings" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(
      screen.getByText("Answer the permission request first"),
    ).toBeVisible();
  });

  it("says nothing about the keyboard when there is nothing to explain", () => {
    render(<Composer />);

    expect(screen.queryByText(/Enter to send/)).toBeNull();
    expect(screen.queryByText(/Shift\+Enter/)).toBeNull();
  });
});
