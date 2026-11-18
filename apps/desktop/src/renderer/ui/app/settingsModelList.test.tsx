import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModelListState } from "@zhiyin/contract";
import { SettingsWithModelList } from "./SettingsWithModelList.js";

/**
 * Settings says where the labs' models and prices come from (ADR 0027):
 * Zhiyin's list in force and its day, a look for a newer one each time the
 * page opens, and a switch that stops Zhiyin asking for one at all.
 */

const shipped: ModelListState = {
  source: "shipped",
  version: 1,
  published: "2026-10-22",
  updates: true,
};

const downloaded: ModelListState = {
  source: "downloaded",
  version: 2,
  published: "2026-11-03",
  updates: true,
  lastCheck: { at: "2026-11-04T09:00:00.000Z", outcome: "updated" },
};

function settings(list: {
  state: () => Promise<ModelListState>;
  check: () => Promise<ModelListState>;
  setUpdates: (enabled: boolean) => Promise<ModelListState>;
}) {
  render(
    <SettingsWithModelList
      notifications={false}
      list={list}
      onClose={() => undefined}
    />,
  );
}

describe("where Settings says the models and prices come from", () => {
  it("names the list in force and its day, and looks for a newer one", async () => {
    // The look's answer exists before the page asks, so it arrives however
    // late the page's request is made.
    const look = Promise.withResolvers<ModelListState>();
    const finishLook = look.resolve;
    settings({
      state: async () => shipped,
      check: () => look.promise,
      setUpdates: async () => shipped,
    });

    expect(
      await screen.findByText(
        /list of October 22, 2026, shipped with this version\. Checking for a newer list…/,
      ),
    ).toBeVisible();

    finishLook(downloaded);

    expect(
      await screen.findByText(
        /list of November 3, 2026, updated since this version shipped\./,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Checking for a newer list/)).toBeNull();
  });

  it("says why no newer list could be used, keeping the one in force", async () => {
    settings({
      state: async () => shipped,
      check: async () => ({
        ...shipped,
        lastCheck: {
          at: "2026-10-22T09:00:00.000Z",
          outcome: "failed",
          reason:
            "GitHub could not be reached. media.zhiyinagent.app could not be reached.",
        },
      }),
      setUpdates: async () => shipped,
    });

    expect(
      await screen.findByText(
        /shipped with this version\. No newer list could be used: GitHub could not be reached\. media\.zhiyinagent\.app could not be reached\./,
      ),
    ).toBeVisible();
  });

  it("asks for no newer list while updates are off, and looks once they are turned on", async () => {
    const check = vi.fn(async () => shipped);
    const setUpdates = vi.fn(async (enabled: boolean) => ({
      ...shipped,
      updates: enabled,
    }));
    settings({
      state: async () => ({ ...shipped, updates: false }),
      check,
      setUpdates,
    });
    const toggle = await screen.findByRole("switch", {
      name: "Keep models and prices up to date",
    });

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(check).not.toHaveBeenCalled();

    fireEvent.click(toggle);

    await waitFor(() => expect(setUpdates).toHaveBeenCalledWith(true));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
