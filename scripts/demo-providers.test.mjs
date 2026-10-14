// The demo draws the window with the providers Zhiyin ships, written out by
// hand, since the window may not import the model client. Only here can both
// be read, so the demo is held to them here.

import { describe, expect, it } from "vitest";
import { ModelProviders } from "@zhiyin/model-client";
import {
  demoDeepSeekMainland,
  demoOpenRouter,
  demoProviderSummaries,
} from "desktop/src/renderer/demo/fixtures/models.ts";

/** A provider as the Model page lists it, without whether a key is stored. */
function listed(provider) {
  return {
    id: provider.id,
    name: provider.name,
    ...(provider.upstreams ? { upstreams: true } : {}),
    ...(provider.unavailable ? { unavailable: provider.unavailable } : {}),
    accounts: provider.accounts.map((account) => ({
      ...(account.region ? { region: account.region } : {}),
      pages: account.pages,
    })),
  };
}

const shipped = new ModelProviders({
  environment: () => undefined,
  credentialEntry: () => ({
    getPassword: async () => undefined,
    setPassword: async () => {},
    deletePassword: async () => false,
  }),
});

describe("the demo's providers", () => {
  it("are the ones Zhiyin ships, with the same platforms and pages", async () => {
    expect(demoProviderSummaries.map(listed)).toEqual(
      (await shipped.list()).map(listed),
    );
  });

  it("name a chosen provider and its pages as Zhiyin ships them", async () => {
    const providers = await shipped.list();
    for (const chosen of [demoOpenRouter, demoDeepSeekMainland]) {
      const provider = providers.find((item) => item.id === chosen.id);
      const account = provider?.accounts.find(
        (item) => item.region?.id === chosen.region?.id,
      );
      expect({ name: chosen.name, pages: chosen.pages }).toEqual({
        name: provider?.name,
        pages: account?.pages,
      });
    }
  });
});
