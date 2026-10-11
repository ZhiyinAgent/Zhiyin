/**
 * A provider that exists only in tests: it records what it is asked to send
 * and answers with a finished, empty response. Shared code is tested against
 * it, so no test of the shared client depends on a real lab's profile.
 */

import type { Provider, SendInput } from "../src/provider.js";

const unlisted = { status: "unavailable" as const, reason: "Not listed." };

export function testProvider(
  seen: SendInput[] = [],
  profile: Partial<Provider> = {},
): Provider {
  return {
    id: "test-provider",
    name: "Test provider",
    keyName: "a test key",
    keyVariable: "TEST_PROVIDER_API_KEY",
    endpoint: "https://provider.test/chat",
    pages: {
      keys: "https://provider.test/keys",
      billing: "https://provider.test/billing",
    },
    send: async function* (input) {
      seen.push(input);
      yield { kind: "done" };
    },
    catalogue: {
      models: async () => unlisted,
      providers: async () => unlisted,
    },
    describe: async () => undefined,
    window: () => ({}),
    reasoning: () => unlisted,
    acceptsImages: () => false,
    checkKey: async () => ({ accepted: true }),
    ...profile,
  } as Provider;
}

/**
 * A lab with two platforms, international and mainland China, each with its
 * own host, accounts and keys.
 */
export function twoRegionProvider(
  seen: SendInput[] = [],
  profile: Partial<Provider> = {},
): Provider {
  const { endpoint: _single, pages: _pages, ...rest } = testProvider(seen);
  void _single;
  void _pages;
  return {
    ...rest,
    id: "two-region-lab",
    name: "Two Region Lab",
    keyName: "a Two Region Lab API key",
    keyVariable: "TWO_REGION_LAB_API_KEY",
    regions: [
      {
        id: "international",
        name: "International",
        endpoint: "https://api.lab.test/v1/chat/completions",
        pages: {
          keys: "https://lab.test/keys",
          billing: "https://lab.test/billing",
        },
      },
      {
        id: "mainland",
        name: "Mainland China",
        keyVariable: "TWO_REGION_LAB_CN_API_KEY",
        endpoint: "https://api.lab.cn.test/v1/chat/completions",
        pages: {
          keys: "https://lab.cn.test/keys",
          billing: "https://lab.cn.test/billing",
        },
      },
    ],
    ...profile,
  } as Provider;
}
