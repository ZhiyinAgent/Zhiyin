/**
 * A person reaches a model through OpenRouter or through its lab's own API
 * (ADR 0015). They choose a provider, a region where the lab runs two
 * platforms, and a model; each request goes where that choice says, with the
 * key kept for that provider and region.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALLOWED_EXTERNAL_URLS } from "@zhiyin/contract";
import { TemporaryFolders } from "@zhiyin/temporary-folders";
import {
  FileModelChoice,
  ModelProviders,
  type CredentialEntry,
  type ModelFetch,
  type ModelProvidersOptions,
} from "../src/index.js";
import type { SendInput } from "../src/provider.js";
import { everyProvider } from "./shipped-providers.js";
import { openRouter } from "../src/providers/openrouter/provider.js";
import { testProvider, twoRegionProvider } from "./test-provider.js";

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

const encoder = new TextEncoder();

/** OpenRouter's side of the wire: every request answered with a short reply. */
function openRouterAnswering(asked: { url: string; key: string }[]) {
  const fetcher: ModelFetch = async (url, init) => {
    asked.push({ url, key: init.headers["Authorization"] ?? "" });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: (async function* () {
        yield encoder.encode(
          `data: ${JSON.stringify({
            id: "gen-1",
            model: "vendor/chosen",
            choices: [{ delta: { content: "Hi" }, finish_reason: "stop" }],
          })}\n\ndata: [DONE]\n\n`,
        );
      })(),
    };
  };
  return fetcher;
}

/** A credential store holding one entry per account name. */
function credentialStore(initial: Record<string, string> = {}) {
  const stored = new Map(Object.entries(initial));
  const entry = (account: string): CredentialEntry => ({
    getPassword: async () => stored.get(account),
    setPassword: async (secret) => void stored.set(account, secret),
    deletePassword: async () => stored.delete(account),
  });
  return { entry, stored };
}

async function drain(events: AsyncIterable<unknown>) {
  for await (const event of events) void event;
}

const hello = { messages: [{ role: "user" as const, content: "Hello" }] };

describe("reaching a model through one of several providers", () => {
  let directory: string;
  let seen: SendInput[];
  let asked: { url: string; key: string }[];

  beforeEach(async () => {
    directory = await folders.make("zhiyin-providers-");
    seen = [];
    asked = [];
  });

  function providers(options: Partial<ModelProvidersOptions> = {}) {
    return new ModelProviders({
      choice: new FileModelChoice(directory),
      environment: () => undefined,
      credentialEntry: credentialStore().entry,
      fetcher: openRouterAnswering(asked),
      // Every key is accepted where it is checked.
      catalogFetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
      providers: [openRouter, twoRegionProvider(seen)],
      ...options,
    });
  }

  it("leaves nothing behind when the choice cannot be saved", async () => {
    // The choice's place holds a folder, which no file replaces.
    await mkdir(join(directory, "model-choice.json"));
    await writeFile(join(directory, "model-choice.json", "blocker"), "");

    await expect(
      new FileModelChoice(directory).set({
        model: "deepseek-chat",
        providers: [],
      }),
    ).rejects.toThrow("The model choice could not be saved.");

    expect(await readdir(directory)).toEqual(["model-choice.json"]);
  });

  it("sends a choice saved before providers were named to OpenRouter, with OpenRouter's key", async () => {
    await writeFile(
      join(directory, "model-choice.json"),
      JSON.stringify({ model: "vendor/chosen", providers: [] }),
      "utf8",
    );
    const client = providers({
      credentialEntry: credentialStore({ openrouter: "openrouter-key" }).entry,
    });

    await drain(client.send(hello));

    expect(asked).toEqual([
      {
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: "Bearer openrouter-key",
      },
    ]);
    expect(seen).toEqual([]);
  });

  it("sends each request to the chosen provider's region, with the key kept for that region", async () => {
    const client = providers({
      credentialEntry: credentialStore({
        "two-region-lab:international": "international-key",
        "two-region-lab:mainland": "mainland-key",
      }).entry,
    });
    await client
      .for({ provider: "two-region-lab", region: "mainland" })
      .selectModel("lab-model", []);

    await drain(client.send(hello));

    expect(
      seen.map(({ endpoint, apiKey, chosen }) => [
        endpoint,
        apiKey,
        chosen.model,
      ]),
    ).toEqual([
      [
        "https://api.lab.cn.test/v1/chat/completions",
        "mainland-key",
        "lab-model",
      ],
    ]);
    expect(asked).toEqual([]);
  });

  it("follows a choice moved to another provider from the next request on", async () => {
    const client = providers({
      credentialEntry: credentialStore({
        openrouter: "openrouter-key",
        "two-region-lab:international": "international-key",
      }).entry,
    });
    await client
      .for({ provider: "openrouter" })
      .selectModel("vendor/chosen", []);
    await drain(client.send(hello));

    await client
      .for({ provider: "two-region-lab", region: "international" })
      .selectModel("lab-model", []);
    await drain(client.send(hello));

    expect(asked).toHaveLength(1);
    expect(seen.map((input) => input.endpoint)).toEqual([
      "https://api.lab.test/v1/chat/completions",
    ]);
  });

  it("keeps the provider and region with the model chosen there, across a restart", async () => {
    await providers()
      .for({ provider: "two-region-lab", region: "mainland" })
      .selectModel("lab-model", []);

    const settings = await providers().settings();

    expect(settings).toMatchObject({
      provider: {
        id: "two-region-lab",
        name: "Two Region Lab",
        region: { id: "mainland", name: "Mainland China" },
      },
      model: "lab-model",
      endpoint: "https://api.lab.cn.test/v1/chat/completions",
    });
  });

  it("names OpenRouter as the provider of a choice saved before providers were named", async () => {
    await writeFile(
      join(directory, "model-choice.json"),
      JSON.stringify({ model: "vendor/chosen", providers: ["one"] }),
      "utf8",
    );

    expect(await providers().settings()).toMatchObject({
      provider: { id: "openrouter", name: "OpenRouter" },
      model: "vendor/chosen",
      providers: ["one"],
    });
  });

  it("keeps one key per provider and region, and OpenRouter's where it always was", async () => {
    const store = credentialStore();
    const client = providers({ credentialEntry: store.entry });

    await client.for({ provider: "openrouter" }).setApiKey("openrouter-key");
    await client
      .for({ provider: "two-region-lab", region: "mainland" })
      .setApiKey("mainland-key");

    expect(Object.fromEntries(store.stored)).toEqual({
      openrouter: "openrouter-key",
      "two-region-lab:mainland": "mainland-key",
    });
    expect(
      (await client.list()).map(({ id, accounts }) => ({
        id,
        accounts: accounts.map(({ region, credential }) => ({
          region: region?.id,
          credential,
        })),
      })),
    ).toEqual([
      {
        id: "openrouter",
        accounts: [
          {
            region: undefined,
            credential: { status: "configured", source: "credentialStore" },
          },
        ],
      },
      {
        id: "two-region-lab",
        accounts: [
          {
            region: "international",
            credential: { status: "missing", source: "none" },
          },
          {
            region: "mainland",
            credential: { status: "configured", source: "credentialStore" },
          },
        ],
      },
    ]);
  });

  it("checks a key with the platform it is for", async () => {
    const checked: (string | undefined)[] = [];
    const client = providers({
      providers: [
        openRouter,
        twoRegionProvider(seen, {
          checkKey: async (_key, _fetcher, region) => {
            checked.push(region);
            return { accepted: true };
          },
        }),
      ],
    });

    await client
      .for({ provider: "two-region-lab", region: "mainland" })
      .setApiKey("mainland-key");

    expect(checked).toEqual(["mainland"]);
  });

  it("removes one region's key and leaves the others", async () => {
    const store = credentialStore({
      openrouter: "openrouter-key",
      "two-region-lab:international": "international-key",
      "two-region-lab:mainland": "mainland-key",
    });

    await providers({ credentialEntry: store.entry })
      .for({ provider: "two-region-lab", region: "mainland" })
      .clearApiKey();

    expect(Object.fromEntries(store.stored)).toEqual({
      openrouter: "openrouter-key",
      "two-region-lab:international": "international-key",
    });
  });

  it("takes a development key from each platform's own variable", async () => {
    const variables: Record<string, string> = {
      TWO_REGION_LAB_API_KEY: "international-key",
      TWO_REGION_LAB_CN_API_KEY: "mainland-key",
    };
    const client = providers({
      environment: (variable) => variables[variable],
    });

    for (const region of ["international", "mainland"]) {
      await client
        .for({ provider: "two-region-lab", region })
        .selectModel("lab-model", []);
      await drain(client.send(hello));
    }

    expect(seen.map((input) => input.apiKey)).toEqual([
      "international-key",
      "mainland-key",
    ]);
  });

  it("never offers one platform's development key to the other", async () => {
    const client = providers({
      environment: (variable) =>
        variable === "TWO_REGION_LAB_API_KEY" ? "international-key" : undefined,
    });

    const listed = await client.list();

    expect(
      listed.map((provider) =>
        provider.accounts.map((account) => account.credential.source),
      ),
    ).toEqual([["none"], ["environment", "none"]]);
  });

  it("names every platform's key variable after Zhiyin, the provider and the platform", () => {
    const variables = everyProvider.flatMap((provider) =>
      provider.regions
        ? provider.regions.map(
            (region) => region.keyVariable ?? provider.keyVariable,
          )
        : [provider.keyVariable],
    );

    expect(variables).toEqual(
      everyProvider.flatMap((provider) => {
        const name = `ZHIYIN_${provider.id.toUpperCase()}`;
        return provider.regions
          ? provider.regions.map((region) =>
              region.id === "mainland"
                ? `${name}_CN_API_KEY`
                : `${name}_API_KEY`,
            )
          : [`${name}_API_KEY`];
      }),
    );
  });

  // Other tools read these names, so a person may have them set for something
  // else; their key must never be used, nor stand in for the one they save.
  it("never takes a key from a variable other tools read", async () => {
    const elsewhere: Record<string, string> = {
      OPENROUTER_API_KEY: "a key",
      ANTHROPIC_API_KEY: "a key",
      OPENAI_API_KEY: "a key",
      MISTRAL_API_KEY: "a key",
      DEEPSEEK_API_KEY: "a key",
      MOONSHOT_API_KEY: "a key",
      ZAI_API_KEY: "a key",
      MINIMAX_API_KEY: "a key",
      DASHSCOPE_API_KEY: "a key",
      MIMO_API_KEY: "a key",
    };
    const client = providers({
      providers: everyProvider,
      environment: (variable) => elsewhere[variable],
    });

    const sources = (await client.list()).flatMap((provider) =>
      provider.accounts.map((account) => account.credential.source),
    );

    expect(new Set(sources)).toEqual(new Set(["none"]));
  });

  it("takes a key meant for Zhiyin from its own variable", async () => {
    const client = providers({
      providers: everyProvider,
      environment: (variable) =>
        variable === "ZHIYIN_ANTHROPIC_API_KEY" ? "a key" : undefined,
    });

    const anthropic = (await client.list()).find(
      (provider) => provider.id === "anthropic",
    );

    expect(anthropic?.accounts.map((account) => account.credential)).toEqual([
      { status: "configured", source: "environment" },
    ]);
  });

  it("asks for the chosen provider's own key when it has none", async () => {
    const client = providers({
      credentialEntry: credentialStore({ openrouter: "openrouter-key" }).entry,
    });
    await client
      .for({ provider: "two-region-lab", region: "mainland" })
      .selectModel("lab-model", []);

    await expect(drain(client.send(hello))).rejects.toMatchObject({
      code: "missingCredential",
      message:
        "Add a Two Region Lab API key on the Model page before starting a task.",
    });
    expect(seen).toEqual([]);
  });

  it("refuses a provider or region it does not know", () => {
    const client = providers();

    for (const target of [
      { provider: "nobody" },
      { provider: "two-region-lab" },
      { provider: "two-region-lab", region: "elsewhere" },
      { provider: "openrouter", region: "mainland" },
    ])
      expect(() => client.for(target)).toThrow(
        expect.objectContaining({ name: "ModelClientError" }),
      );
  });

  it("treats a stored choice naming a provider it cannot reach as no choice", async () => {
    await writeFile(
      join(directory, "model-choice.json"),
      JSON.stringify({
        provider: "retired-lab",
        model: "old-model",
        providers: [],
      }),
      "utf8",
    );

    await expect(drain(providers().send(hello))).rejects.toMatchObject({
      code: "noModel",
    });
    expect(asked).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("keeps a provider whose path does not work yet visibly unavailable", async () => {
    const unfinished = testProvider(seen, {
      id: "unfinished-lab",
      name: "Unfinished Lab",
      unavailable: "Not checked against the lab yet.",
    });
    await writeFile(
      join(directory, "model-choice.json"),
      JSON.stringify({ provider: "unfinished-lab", model: "m", providers: [] }),
      "utf8",
    );
    const client = providers({
      providers: [openRouter, unfinished],
      environment: () => "some-key",
    });

    expect((await client.list())[1]).toMatchObject({
      id: "unfinished-lab",
      unavailable: "Not checked against the lab yet.",
    });
    await expect(drain(client.send(hello))).rejects.toMatchObject({
      code: "modelUnavailable",
    });
    await expect(
      client.for({ provider: "unfinished-lab" }).selectModel("m", []),
    ).rejects.toMatchObject({ code: "modelUnavailable" });
    expect(seen).toEqual([]);
  });

  it("uses a choice fixed by the environment and refuses to change it", async () => {
    const client = providers({
      fixed: {
        provider: "two-region-lab",
        region: "mainland",
        model: "lab-model",
      },
      environment: () => "some-key",
    });

    await drain(client.send(hello));

    expect(seen.map((input) => [input.endpoint, input.chosen.model])).toEqual([
      ["https://api.lab.cn.test/v1/chat/completions", "lab-model"],
    ]);
    await expect(
      client.for({ provider: "openrouter" }).selectModel("vendor/other", []),
    ).rejects.toMatchObject({ code: "modelUnavailable" });
  });

  it("sends every request to a development endpoint when one is given", async () => {
    const client = providers({
      endpoint: "http://127.0.0.1:9/v1/chat/completions",
      environment: () => "some-key",
    });
    await client
      .for({ provider: "two-region-lab", region: "international" })
      .selectModel("lab-model", []);

    await drain(client.send(hello));

    expect(seen.map((input) => input.endpoint)).toEqual([
      "http://127.0.0.1:9/v1/chat/completions",
    ]);
  });
});

describe("the providers Zhiyin ships", () => {
  it("offer each lab on its platforms, each one usable", async () => {
    const shipped = new ModelProviders({
      environment: () => undefined,
      credentialEntry: credentialStore().entry,
    });

    expect(
      (await shipped.list()).map(({ id, unavailable, accounts }) => ({
        id,
        unavailable: unavailable !== undefined,
        regions: accounts.map((account) => account.region?.id),
      })),
    ).toEqual([
      { id: "openrouter", unavailable: false, regions: [undefined] },
      { id: "anthropic", unavailable: false, regions: [undefined] },
      { id: "openai", unavailable: false, regions: [undefined] },
      {
        id: "zai",
        unavailable: false,
        regions: ["international", "mainland"],
      },
      {
        id: "deepseek",
        unavailable: false,
        regions: ["international", "mainland"],
      },
      {
        id: "moonshot",
        unavailable: false,
        regions: ["international", "mainland"],
      },
      {
        id: "minimax",
        unavailable: false,
        regions: ["international", "mainland"],
      },
      {
        id: "xiaomi",
        unavailable: false,
        regions: ["international", "mainland"],
      },
      {
        id: "qwen",
        unavailable: false,
        regions: ["international", "mainland"],
      },
      { id: "mistral", unavailable: false, regions: [undefined] },
    ]);
  });

  it("name, for each account, where its keys are made and its billing kept, pages Zhiyin may open", async () => {
    const shipped = new ModelProviders({
      environment: () => undefined,
      credentialEntry: credentialStore().entry,
    });

    const pages = (await shipped.list()).flatMap(({ id, accounts }) =>
      accounts.map((account) => ({
        account: account.region ? `${id}:${account.region.id}` : id,
        ...account.pages,
      })),
    );

    expect(pages).toContainEqual({
      account: "openrouter",
      keys: "https://openrouter.ai/settings/keys",
      billing: "https://openrouter.ai/settings/credits",
    });
    expect(pages).toContainEqual({
      account: "qwen:mainland",
      keys: "https://platform.qianwenai.com/home/api-keys",
      billing: "https://platform.qianwenai.com/home/",
    });
    for (const page of pages) {
      expect(ALLOWED_EXTERNAL_URLS).toContain(page.keys);
      expect(ALLOWED_EXTERNAL_URLS).toContain(page.billing);
    }
  });

  it("let a person choose upstreams on OpenRouter alone", async () => {
    const shipped = new ModelProviders({
      environment: () => undefined,
      credentialEntry: credentialStore().entry,
    });

    expect(
      (await shipped.list())
        .filter((provider) => provider.upstreams)
        .map((provider) => provider.id),
    ).toEqual(["openrouter"]);
    expect((await shipped.settings()).provider?.upstreams).toBe(true);
  });

  it("say where the chosen account's keys and billing are, beside who requests go to", async () => {
    const shipped = new ModelProviders({
      environment: () => undefined,
      credentialEntry: credentialStore().entry,
    });

    expect((await shipped.settings()).provider).toEqual({
      id: "openrouter",
      name: "OpenRouter",
      upstreams: true,
      pages: {
        keys: "https://openrouter.ai/settings/keys",
        billing: "https://openrouter.ai/settings/credits",
      },
    });
  });
});
