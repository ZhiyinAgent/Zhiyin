/**
 * A newer model list is read from GitHub while the app runs (ADR 0031). It is
 * taken only when a key Zhiyin ships signed its exact bytes, it reads in this
 * version's format, and it is newer than the list in force; anything else
 * leaves the list in force as it was. While updates are off, nothing is sent.
 */

import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import type { Network } from "../src/keyed-fetch.js";
import type { ModelListFile } from "../src/model-list-format.js";
import { ModelListUpdates } from "../src/model-list-updates.js";
import { ModelProviders } from "../src/model-providers.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

const addresses = {
  list: "https://lists.test/models.json",
  signature: "https://lists.test/models.json.sig",
};

function keyPair(): {
  readonly id: string;
  readonly secret: KeyObject;
  readonly spki: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    id: "test-key",
    secret: privateKey,
    spki: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

/** A list in this version's format, priced by DeepSeek's two platforms. */
function list(version: number, input = 0.15): ModelListFile {
  return {
    format: 1,
    version,
    published: "2026-10-22",
    labs: {
      deepseek: {
        checked: "2026-10-22",
        sources: ["DeepSeek's pricing pages"],
        models: [
          {
            id: "deepseek-flash",
            name: "DeepSeek V4.1 Flash",
            contextWindow: 1_048_576,
            acceptsImages: true,
            reasoning: {
              status: "available",
              required: false,
              defaultEnabled: true,
              efforts: ["high"],
            },
            offered: {
              international: { currency: "USD", input, output: 0.6 },
              mainland: { currency: "CNY", input: 1, output: 4 },
            },
          },
        ],
      },
    },
  };
}

type Published = { readonly text: string; readonly signature: string };

/** A list as GitHub would serve it, signed by `key` with its version named. */
function published(
  value: unknown,
  key: { readonly id: string; readonly secret: KeyObject },
  version = (value as { version: number }).version,
): Published {
  const text = JSON.stringify(value, null, 2) + "\n";
  return {
    text,
    signature: JSON.stringify({
      key: key.id,
      version,
      signature: sign(null, Buffer.from(text), key.secret).toString("base64"),
    }),
  };
}

/** GitHub as the tests set it up, recording each request it is sent. */
function github(served: Published | "offline") {
  const requests: { url: string; init: RequestInit }[] = [];
  const network: Network = async (url, init) => {
    requests.push({ url, init });
    if (served === "offline") throw new TypeError("fetch failed");
    const body = url === addresses.list ? served.text : served.signature;
    return new Response(body, { status: 200 });
  };
  return { network, requests };
}

async function updates(
  served: Published | "offline",
  options: { readonly key?: string; readonly directory?: string } = {},
) {
  const key = keyPair();
  const directory = options.directory ?? (await folders.make("zhiyin-list-"));
  const remote = github(served);
  return {
    key,
    directory,
    requests: remote.requests,
    updates: new ModelListUpdates({
      directory,
      keys: { "test-key": options.key ?? key.spki },
      network: remote.network,
      shipped: list(3),
      addresses,
      now: () => new Date("2026-10-22T10:00:00Z"),
    }),
  };
}

const deepSeekInput = (lists: ModelListUpdates) =>
  lists.lab("deepseek")?.models[0]?.offered["international"]?.input;

describe("a newer model list", () => {
  it("is taken when a shipped key signed it, and its prices answer from then on", async () => {
    const key = keyPair();
    const { updates: lists } = await updates(published(list(4, 0.2), key), {
      key: key.spki,
    });
    const changed: string[] = [];
    lists.onChanged(() => changed.push("changed"));

    expect(await lists.refresh()).toEqual({
      at: "2026-10-22T10:00:00.000Z",
      outcome: "updated",
    });
    expect(deepSeekInput(lists)).toBe(0.2);
    expect(lists.state()).toMatchObject({
      source: "downloaded",
      version: 4,
      updates: true,
    });
    expect(changed).toEqual(["changed"]);
  });

  it("prices the lab's models on the Model page as soon as it is taken", async () => {
    const key = keyPair();
    const { updates: lists } = await updates(published(list(4, 0.2), key), {
      key: key.spki,
    });
    const providers = new ModelProviders({
      environment: () => undefined,
      // No key, and none read from this computer's credential store.
      credentialEntry: () => ({
        getPassword: async () => undefined,
        setPassword: async () => {},
        deletePassword: async () => true,
      }),
      modelLists: lists,
      // DeepSeek's own listing cannot be read, so the list stands alone.
      catalogFetch: async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      }),
    });
    const deepSeek = providers.for({
      provider: "deepseek",
      region: "international",
    });
    const inputPrice = async () => {
      const catalog = await deepSeek.models();
      return catalog.status === "ready"
        ? catalog.models.find((model) => model.id === "deepseek-flash")?.price
            ?.input
        : undefined;
    };

    expect(await inputPrice()).toBe(0.15);
    await lists.refresh();
    expect(await inputPrice()).toBe(0.2);
  });

  it("asks GitHub for nothing of the person's: no cookies, no stored credentials, no query", async () => {
    const key = keyPair();
    const { updates: lists, requests } = await updates(
      published(list(4), key),
      { key: key.spki },
    );

    await lists.refresh();

    expect(requests.map((request) => request.url)).toEqual([
      addresses.signature,
      addresses.list,
    ]);
    for (const { init } of requests)
      expect(init).toMatchObject({
        method: "GET",
        credentials: "omit",
        redirect: "error",
      });
  });

  it("is not downloaded when its signature names a version no newer than the one in force", async () => {
    const key = keyPair();
    const { updates: lists, requests } = await updates(
      published(list(3), key),
      { key: key.spki },
    );

    expect(await lists.refresh()).toMatchObject({ outcome: "unchanged" });
    expect(requests.map((request) => request.url)).toEqual([
      addresses.signature,
    ]);
    expect(lists.state().source).toBe("shipped");
  });

  it("sends nothing while updates are off, and the choice is kept for the next start", async () => {
    const key = keyPair();
    const {
      updates: lists,
      requests,
      directory,
    } = await updates(published(list(4), key), { key: key.spki });

    await lists.setUpdates(false);

    expect(await lists.refresh()).toEqual({ outcome: "off" });
    expect(requests).toEqual([]);
    const { updates: later } = await updates("offline", { directory });
    await later.load();
    expect(later.state().updates).toBe(false);
  });

  it("shares one look between two asked at once", async () => {
    const key = keyPair();
    const { updates: lists, requests } = await updates(
      published(list(4), key),
      { key: key.spki },
    );

    await Promise.all([lists.refresh(), lists.refresh()]);

    expect(requests).toHaveLength(2);
  });

  it("is kept, and taken again at the next start after its signature is checked again", async () => {
    const key = keyPair();
    const first = await updates(published(list(4, 0.2), key), {
      key: key.spki,
    });
    await first.updates.refresh();

    const next = await updates("offline", {
      key: key.spki,
      directory: first.directory,
    });
    await next.updates.load();

    expect(next.updates.state()).toMatchObject({
      source: "downloaded",
      version: 4,
    });
    expect(deepSeekInput(next.updates)).toBe(0.2);
  });

  it("is not taken at the next start once what was kept no longer matches its signature", async () => {
    const key = keyPair();
    const first = await updates(published(list(4, 0.2), key), {
      key: key.spki,
    });
    await first.updates.refresh();
    const file = join(first.directory, "downloaded.json");
    const kept = JSON.parse(await readFile(file, "utf8")) as { list: string };
    await writeFile(
      file,
      JSON.stringify({ ...kept, list: kept.list.replace("0.2", "0.01") }),
    );

    const next = await updates("offline", {
      key: key.spki,
      directory: first.directory,
    });
    await next.updates.load();

    expect(next.updates.state().source).toBe("shipped");
    expect(deepSeekInput(next.updates)).toBe(0.15);
  });
});

describe("a list that is not taken, leaving the list in force", () => {
  async function refused(served: Published, key: { spki: string }) {
    const { updates: lists } = await updates(served, { key: key.spki });
    const look = await lists.refresh();
    expect(lists.state()).toMatchObject({ source: "shipped", version: 3 });
    expect(deepSeekInput(lists)).toBe(0.15);
    return look;
  }

  it("signed by a key Zhiyin does not ship", async () => {
    const shipped = keyPair();
    const stranger = keyPair();

    expect(await refused(published(list(4), stranger), shipped)).toMatchObject({
      outcome: "failed",
      reason: "The newer list's signature does not match it.",
    });
  });

  it("naming a key id Zhiyin does not know", async () => {
    const key = keyPair();

    expect(
      await refused(published(list(4), { ...key, id: "other-key" }), key),
    ).toMatchObject({
      outcome: "failed",
      reason: "The newer list is signed with a key this version does not know.",
    });
  });

  it("changed after it was signed", async () => {
    const key = keyPair();
    const signed = published(list(4), key);

    expect(
      await refused(
        { ...signed, text: signed.text.replace("0.15", "0.01") },
        key,
      ),
    ).toMatchObject({
      outcome: "failed",
      reason: "The newer list's signature does not match it.",
    });
  });

  it("older than its signature file claims", async () => {
    const key = keyPair();

    expect(await refused(published(list(2), key, 9), key)).toMatchObject({
      outcome: "failed",
      reason: "The newer list is not the version its signature names.",
    });
  });

  it("with a field the format does not have", async () => {
    const key = keyPair();
    const withEndpoint = {
      ...list(4),
      labs: {
        deepseek: {
          ...list(4).labs["deepseek"],
          endpoint: "https://elsewhere.test",
        },
      },
    };

    expect(await refused(published(withEndpoint, key), key)).toMatchObject({
      outcome: "failed",
      reason:
        "The newer list is unreadable: labs.deepseek.endpoint is not a field the list has.",
    });
  });

  it.each([
    ["free", 0, "is not a price above 0 and at most 1000 USD."],
    [
      "priced past any model",
      5_000,
      "is not a price above 0 and at most 1000 USD.",
    ],
  ])("with a model %s", async (_name, input, problem) => {
    const key = keyPair();

    expect(await refused(published(list(4, input), key), key)).toMatchObject({
      outcome: "failed",
      reason: `The newer list is unreadable: labs.deepseek.models[0].offered.international.input ${problem}`,
    });
  });

  it("offering a model on a platform the lab does not run", async () => {
    const key = keyPair();
    const elsewhere = list(4);
    const model = elsewhere.labs["deepseek"]!.models[0]!;
    const onMars = {
      ...elsewhere,
      labs: {
        deepseek: {
          ...elsewhere.labs["deepseek"],
          models: [{ ...model, offered: { mars: model.offered["mainland"] } }],
        },
      },
    };

    expect(await refused(published(onMars, key), key)).toMatchObject({
      outcome: "failed",
      reason:
        "The newer list is unreadable: labs.deepseek.models[0].offered.mars is not a field the list has.",
    });
  });

  it("when GitHub cannot be reached", async () => {
    const { updates: lists } = await updates("offline");

    expect(await lists.refresh()).toMatchObject({
      outcome: "failed",
      reason: "GitHub could not be reached.",
    });
    expect(lists.state()).toMatchObject({
      source: "shipped",
      lastCheck: { outcome: "failed", reason: "GitHub could not be reached." },
    });
  });
});
