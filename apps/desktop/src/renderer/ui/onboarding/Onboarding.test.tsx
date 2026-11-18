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
  it("connects a model between what the person is here for and the look, in the step it is handed", async () => {
    const complete = vi.fn(async () => {});
    render(
      <Onboarding
        onComplete={complete}
        onLook={async () => {}}
        look={{ look: "ink", strength: "default" }}
        modelStep={({ label, onBack, onContinue, onLater }) => (
          <section aria-label="Model step">
            <p>{label}</p>
            <button onClick={onBack}>Back</button>
            <button onClick={onLater}>Set up later</button>
            <button onClick={onContinue}>Continue</button>
          </section>
        )}
      />,
    );
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Build software/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const step = screen.getByRole("region", { name: "Model step" });
    expect(step).toHaveTextContent("STEP 2 OF 3");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("button", { name: /Build software/ }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Set up later" }));

    expect(
      screen.getByRole("heading", { name: "How should Zhiyin look?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Step 3 of 3/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("region", { name: "Model step" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Start exploring" }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(["engineering"]));
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
