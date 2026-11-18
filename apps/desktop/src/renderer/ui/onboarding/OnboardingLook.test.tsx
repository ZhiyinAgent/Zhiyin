import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { lookIds, type LookChoice } from "@zhiyin/contract";
import { describe, expect, it, vi } from "vitest";
import { lookWords } from "../shared/index.js";
import { Onboarding } from "./Onboarding.js";

const inInk: LookChoice = { look: "ink", strength: "default" };

function withLooks(
  more: {
    onLook?: (choice: LookChoice) => Promise<void>;
    onComplete?: (interests: readonly string[]) => Promise<void>;
  } = {},
) {
  const onLook = more.onLook ?? vi.fn(async () => {});
  const onComplete = more.onComplete ?? vi.fn(async () => {});
  render(<Onboarding onComplete={onComplete} onLook={onLook} look={inInk} />);
  return { onLook, onComplete };
}

const toLooks = () =>
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

describe("Onboarding's look step", () => {
  it("asks how Zhiyin should look after the interests, with one choice per listed look", () => {
    withLooks();
    expect(screen.getByText(/Step 1 of 2/i)).toBeInTheDocument();
    toLooks();

    expect(
      screen.getByRole("heading", { name: "How should Zhiyin look?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Step 2 of 2/i)).toBeInTheDocument();
    const looks = screen.getByRole("radiogroup", { name: "Look" });
    expect(
      [...looks.querySelectorAll('input[type="radio"]')].map((radio) =>
        radio.getAttribute("value"),
      ),
    ).toEqual([...lookIds]);
    for (const id of lookIds)
      expect(
        screen.getByRole("radio", { name: new RegExp(lookWords[id].name) }),
      ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^Ink/ })).toBeChecked();
  });

  it("wears a look as soon as it is chosen, keeping the strength", async () => {
    const { onLook } = withLooks();
    toLooks();
    fireEvent.click(screen.getByRole("radio", { name: /^Dots/ }));

    await waitFor(() =>
      expect(onLook).toHaveBeenCalledWith({
        look: "dots",
        strength: "default",
      }),
    );
    expect(screen.getByRole("radio", { name: /^Dots/ })).toBeChecked();
  });

  it("goes back to the interests with them kept", () => {
    withLooks();
    fireEvent.click(screen.getByRole("button", { name: /Build software/ }));
    toLooks();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(
      screen.getByRole("button", { name: /Build software/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("saves the interests when the person starts", async () => {
    const { onComplete } = withLooks();
    fireEvent.click(screen.getByRole("button", { name: /Understand data/ }));
    toLooks();
    fireEvent.click(screen.getByRole("button", { name: "Start exploring" }));

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith(["data-science"]),
    );
  });

  it("keeps the look it was wearing, and says so, when a choice cannot be saved", async () => {
    withLooks({
      onLook: async () => {
        throw new Error("offline");
      },
    });
    toLooks();
    fireEvent.click(screen.getByRole("radio", { name: /^Neutral/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be changed",
    );
    expect(screen.getByRole("radio", { name: /^Ink/ })).toBeChecked();
  });
});
