import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProviderSettings } from "@zhiyin/contract";
import { useReviewerLabel } from "./reviewerLabel.js";

const chosen = {
  provider: "deepseek",
  region: "mainland",
  model: "deepseek-reasoner",
  providers: [],
};

const reported: ProviderSettings = {
  provider: {
    id: "deepseek",
    name: "DeepSeek",
    region: { id: "mainland", name: "Mainland China" },
    pages: {
      keys: "https://platform.deepseek.com/api_keys",
      billing: "https://platform.deepseek.com/",
    },
  },
  model: "deepseek-reasoner",
  modelName: "DeepSeek Reasoner",
  endpoint: "https://api.deepseek.com/chat/completions",
  credential: { status: "configured", source: "credentialStore" },
};

describe("the name Settings gives the model chosen for reviews", () => {
  it("is its id at once, then its name and where it is reached once its provider answers", async () => {
    const { result } = renderHook(() =>
      useReviewerLabel({ ...chosen }, async () => reported),
    );

    expect(result.current).toBe("deepseek-reasoner");
    await waitFor(() =>
      expect(result.current).toBe(
        "DeepSeek Reasoner on DeepSeek · Mainland China",
      ),
    );
  });

  it("stays its id when its provider cannot be read", async () => {
    const read = vi.fn(async () => {
      throw new Error("The keyring is locked.");
    });
    const { result } = renderHook(() => useReviewerLabel(chosen, read));

    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(result.current).toBe("deepseek-reasoner");
  });

  it("is nothing while reviews use the conversation's model, and nothing is read", () => {
    const read = vi.fn(async () => reported);
    const { result } = renderHook(() => useReviewerLabel(undefined, read));

    expect(result.current).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
});
