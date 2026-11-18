/**
 * Three different things can happen to a key, and they must not all read like
 * the fourth. Being told "that key was not accepted" when the key is fine and
 * the wifi is down sends somebody to regenerate a key they did not need to.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiKeySaveOutcome } from "@zhiyin/contract";
import { ApiKeyDialog } from "./ApiKeyDialog.js";

function open(
  onSaveApiKey: (apiKey: string) => Promise<ApiKeySaveOutcome>,
  onClose = vi.fn(),
) {
  render(
    <ApiKeyDialog
      providerName="OpenRouter"
      credential={{ status: "missing", source: "none" }}
      onSaveApiKey={onSaveApiKey}
      onClearApiKey={vi.fn()}
      onClose={onClose}
    />,
  );
  return { onClose };
}

function type(value: string) {
  const field = screen.getByLabelText("Paste your key");
  fireEvent.change(field, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
}

describe("saving an OpenRouter key", () => {
  it("closes without comment when the provider accepts it", async () => {
    const { onClose } = open(async () => ({ status: "accepted" }));

    type("sk-or-v1-good");

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("stays open and repeats the provider's refusal", async () => {
    const { onClose } = open(async () => ({
      status: "refused",
      reason: "OpenRouter rejected the API key.",
    }));

    type("sk-or-v1-bad");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "OpenRouter rejected the API key.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("puts focus back in the key field once a key is refused, so another can be pasted", async () => {
    open(async () => ({
      status: "refused",
      reason: "OpenRouter rejected the API key.",
    }));
    const field = screen.getByLabelText("Paste your key");
    fireEvent.change(field, { target: { value: "sk-or-v1-bad" } });
    const save = screen.getByRole("button", { name: /save/i });
    save.focus();
    fireEvent.click(save);

    await screen.findByRole("alert");
    expect(field).toHaveFocus();
    expect(field).toHaveAccessibleDescription(
      "OpenRouter rejected the API key.",
    );
  });

  it("says a key it could not check was kept, rather than that it was wrong", async () => {
    open(async () => ({
      status: "unverified",
      reason:
        "The key was saved but could not be checked with OpenRouter. If it turns out to be wrong, requests will say so.",
    }));

    type("sk-or-v1-unknown");

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("saved but could not be checked");
    expect(notice.textContent).not.toMatch(/not accepted|rejected/i);
  });
});
