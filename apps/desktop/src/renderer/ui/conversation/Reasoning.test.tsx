import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer.js";

describe("reasoning presentation", () => {
  it("sends the chosen reasoning setting with the message", async () => {
    const submit = vi.fn();
    render(
      <Composer
        reasoningCapabilities={{
          status: "available",
          required: false,
          defaultEnabled: true,
          defaultEffort: "high",
          efforts: ["high", "low"],
        }}
        onSubmit={submit}
      />,
    );
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reasoning settings" }));
    fireEvent.change(screen.getByRole("slider", { name: "Reasoning effort" }), {
      target: { value: "1" },
    });
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "Low");
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(submit).toHaveBeenCalledWith("Hello", {
      enabled: true,
      effort: "low",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reasoning settings" }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reasoning settings" }));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "Off");
    fireEvent.change(screen.getByLabelText("Message Zhiyin"), {
      target: { value: "Without thinking" },
    });
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(submit).toHaveBeenLastCalledWith("Without thinking", {
      enabled: false,
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Reasoning settings")).not.toBeDisabled(),
    );
  });

  it("explains mandatory reasoning and stays editable during a turn", () => {
    const { rerender } = render(
      <Composer
        running
        reasoningCapabilities={{
          status: "available",
          required: true,
          defaultEnabled: true,
          defaultEffort: "max",
          efforts: ["max", "high", "low"],
        }}
      />,
    );
    expect(screen.getByLabelText("Reasoning settings")).not.toBeDisabled();
    rerender(
      <Composer
        reasoningCapabilities={{
          status: "available",
          required: true,
          defaultEnabled: true,
          defaultEffort: "max",
          efforts: ["max", "high", "low"],
        }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Reasoning settings"));
    expect(screen.getByText("Required by this model")).toBeVisible();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "Low");
    expect(screen.getByRole("slider")).toHaveAttribute("max", "2");
    fireEvent.click(screen.getByLabelText("Reset reasoning to model default"));
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "Max");
  });

  it("opens the effort slider from the bulb and dismisses with Escape or outside interaction", () => {
    render(
      <Composer
        reasoningCapabilities={{
          status: "available",
          required: false,
          defaultEnabled: true,
          efforts: ["low", "high"],
        }}
      />,
    );
    const bulb = screen.getByLabelText("Reasoning settings");
    fireEvent.click(bulb);
    expect(screen.getByRole("slider")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("slider"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(bulb).toHaveFocus();
    fireEvent.click(bulb);
    fireEvent.pointerDown(screen.getByLabelText("Message Zhiyin"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps unavailable controls compact and supports on/off without effort levels", () => {
    const { rerender } = render(
      <Composer
        reasoningCapabilities={{
          status: "unavailable",
          reason: "No settings reported",
        }}
      />,
    );
    expect(
      screen.getByLabelText("Reasoning settings unavailable"),
    ).toBeDisabled();
    rerender(
      <Composer
        reasoningCapabilities={{
          status: "available",
          required: false,
          defaultEnabled: false,
          efforts: [],
        }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Reasoning settings"));
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "Off");
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "On");
  });
});
