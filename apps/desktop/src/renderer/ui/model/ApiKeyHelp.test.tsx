import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OPENROUTER_KEYS_URL } from "@zhiyin/contract";
import { ApiKeyDialog } from "./ApiKeyDialog.js";

/**
 * Someone meeting OpenRouter for the first time reads what the key is for,
 * that it is paid, where to get one and where it is kept, before the field.
 */
describe("what an API key is", () => {
  it("is said above the field, with OpenRouter's own page to make one", () => {
    const onOpenExternalUrl = vi.fn(async () => undefined);
    render(
      <ApiKeyDialog
        credential={{ status: "missing", source: "none" }}
        onSaveApiKey={vi.fn()}
        onClearApiKey={vi.fn()}
        onClose={vi.fn()}
        onOpenExternalUrl={onOpenExternalUrl}
      />,
    );

    expect(
      screen.getByText(
        "The key lets Zhiyin use AI models through your OpenRouter account. OpenRouter charges that account for what Zhiyin uses.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Zhiyin keeps the key in Windows Credential Manager and sends it only to OpenRouter.",
      ),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Get a key on OpenRouter" }),
    );

    expect(onOpenExternalUrl).toHaveBeenCalledWith(OPENROUTER_KEYS_URL);
  });

  it("says beside a saved key where it is kept, and how to stop it working anywhere", () => {
    render(
      <ApiKeyDialog
        credential={{ status: "configured", source: "credentialStore" }}
        onSaveApiKey={vi.fn()}
        onClearApiKey={vi.fn()}
        onClose={vi.fn()}
        onOpenExternalUrl={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Zhiyin keeps the key in Windows Credential Manager and sends it only to OpenRouter.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Remove only makes Zhiyin forget it. To stop it working anywhere, delete it on OpenRouter's keys page.",
      ),
    ).toBeVisible();
  });
});
