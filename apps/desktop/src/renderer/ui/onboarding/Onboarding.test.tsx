import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding.js";

describe("Onboarding", () => {
  it("saves the selected interests without requiring a profile", async () => {
    const complete = vi.fn(async () => {});
    render(<Onboarding onComplete={complete} />);
    fireEvent.click(screen.getByRole("button", { name: /Build software/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /Research a question/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Make it yours" }));
    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith(["engineering", "research"]),
    );
  });
  it("keeps choices available after a failed save", async () => {
    render(
      <Onboarding
        onComplete={async () => {
          throw new Error("offline");
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start exploring" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be saved",
    );
    expect(
      screen.getByRole("button", { name: "Start exploring" }),
    ).toBeEnabled();
  });
});
