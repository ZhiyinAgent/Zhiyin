import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import {
  FilePluginStore,
  PluginStoreError,
  SHIPPED,
  loadPluginDirectory,
} from "../src/index.js";

async function temporaryRoot(label: string): Promise<string> {
  return folders.make(`zhiyin-plugin-${label}-`);
}

const folders = new TemporaryFolders();

afterEach(() => folders.removeAll());

type PackageOptions = {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  readonly hooks?: string;
  readonly logo?: string;
  readonly skill?: string;
  /** Adds a connector; an object adds these fields to its declaration. */
  readonly mcp?: boolean | Readonly<Record<string, unknown>>;
  /** The stages of its work the package declares for its skills. */
  readonly stages?: unknown;
};

async function writePackage(
  parent: string,
  options: PackageOptions = {},
): Promise<string> {
  const name = options.name ?? "research-helper";
  const version = options.version ?? "1.0.0";
  const root = join(parent, `${name}-${version}`);
  await mkdir(root, { recursive: true });
  const openai =
    options.hooks || options.logo
      ? {
          ...(options.hooks ? { hooks: options.hooks } : {}),
          ...(options.logo
            ? {
                interface: {
                  displayName: "Research Helper",
                  logo: options.logo,
                },
              }
            : {}),
        }
      : undefined;
  await writeFile(
    join(root, "plugin.json"),
    JSON.stringify(
      {
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name,
        version,
        description: options.description ?? "Research with primary sources.",
        ...(openai || options.stages !== undefined
          ? {
              extensions: {
                ...(openai ? { "com.openai": openai } : {}),
                ...(options.stages !== undefined
                  ? { "com.zhiyin": { stages: options.stages } }
                  : {}),
              },
            }
          : {}),
      },
      null,
      2,
    ),
    "utf8",
  );
  if (options.skill !== "none") {
    const skill = options.skill ?? "research";
    const skillRoot = join(root, "skills", skill);
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      `---\nname: ${skill}\ndescription: Find and compare primary sources.\n---\n\nOpen the primary sources and report disagreements.\n`,
      "utf8",
    );
  }
  if (options.mcp) {
    await writeFile(
      join(root, "mcp.json"),
      JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: {
          search: {
            type: "streamable-http",
            url: "https://example.com/mcp",
            ...(typeof options.mcp === "object" ? options.mcp : {}),
          },
        },
      }),
      "utf8",
    );
  }
  return root;
}

const personal = { source: "personal", sourceId: "local-import" } as const;

describe("portable plugin directories", () => {
  it("parses fixed portable components and preserves source provenance", async () => {
    const source = await writePackage(await temporaryRoot("parse"), {
      mcp: true,
    });

    const plugin = await loadPluginDirectory(source, personal);

    expect(plugin).toMatchObject({
      manifest: {
        name: "research-helper",
        version: "1.0.0",
        description: "Research with primary sources.",
      },
      provenance: personal,
      skills: [
        {
          id: "research-helper/research",
          name: "research",
        },
      ],
      mcpServers: [
        {
          id: "research-helper/search",
          type: "streamable-http",
          url: "https://example.com/mcp",
        },
      ],
    });
  });

  it("reads files an editor saved with a byte-order mark", async () => {
    const source = await writePackage(await temporaryRoot("bom"), {
      mcp: true,
    });
    for (const file of [
      "plugin.json",
      "mcp.json",
      join("skills", "research", "SKILL.md"),
    ]) {
      const path = join(source, file);
      await writeFile(path, `\uFEFF${await readFile(path, "utf8")}`, "utf8");
    }

    const plugin = await loadPluginDirectory(source, personal);

    expect(plugin).toMatchObject({
      manifest: { name: "research-helper" },
      skills: [{ name: "research" }],
      mcpServers: [{ id: "research-helper/search" }],
    });
  });

  it.each([
    [">", "Find and compare primary sources, then report where they disagree."],
    [
      ">-",
      "Find and compare primary sources, then report where they disagree.",
    ],
    [
      "|",
      "Find and compare primary sources,\nthen report where they disagree.",
    ],
  ])(
    "reads a skill description written as a YAML block (%s)",
    async (indicator, description) => {
      const source = await writePackage(await temporaryRoot("block"));
      await writeFile(
        join(source, "skills", "research", "SKILL.md"),
        [
          "---",
          "name: research",
          `description: ${indicator}`,
          "  Find and compare primary sources,",
          "  then report where they disagree.",
          "---",
          "",
          "Open the primary sources and report disagreements.",
          "",
        ].join("\n"),
        "utf8",
      );

      const plugin = await loadPluginDirectory(source, personal);

      expect(plugin.skills).toMatchObject([{ description }]);
    },
  );

  it("refuses a package of more files and folders than a plugin needs, without reading on", async () => {
    const source = await writePackage(await temporaryRoot("crowded"));
    const references = join(source, "references");
    await mkdir(references);
    // The package already holds plugin.json and its skill (four entries).
    await Promise.all(
      Array.from({ length: 1_996 }, (_, index) =>
        writeFile(join(references, `${index}.md`), ""),
      ),
    );

    await expect(loadPluginDirectory(source, personal)).rejects.toThrow(
      "A plugin package may hold at most 2,000 files and folders.",
    );
  });

  it("refuses a connector reached over plain http, unless it runs on this computer", async () => {
    const parent = await temporaryRoot("plain-http");
    const remote = await writePackage(parent, {
      name: "remote-plain",
      mcp: { url: "http://search.example/mcp" },
    });
    const local = await writePackage(parent, {
      name: "local-plain",
      mcp: { url: "http://localhost:3100/mcp" },
    });

    await expect(loadPluginDirectory(remote, personal)).rejects.toThrow(
      "MCP server “remote-plain/search” must use https unless it runs on this computer.",
    );
    expect((await loadPluginDirectory(local, personal)).mcpServers).toEqual([
      expect.objectContaining({ url: "http://localhost:3100/mcp" }),
    ]);
  });

  it("refuses a connector whose address carries a credential, or is no http address, as a connection would refuse to dial it", async () => {
    const parent = await temporaryRoot("address-credentials");
    const refused = await Promise.all(
      [
        "https://user:secret@search.example/mcp",
        "https://search.example/mcp?api_key=abc",
        "https://search.example/mcp?token=abc",
        "ftp://search.example/mcp",
        "not an address",
      ].map((url, index) =>
        writePackage(parent, { name: `address-${index}`, mcp: { url } }),
      ),
    );
    const plain = await writePackage(parent, {
      name: "address-plain",
      mcp: { url: "https://search.example/mcp?region=eu" },
    });

    for (const source of refused)
      await expect(loadPluginDirectory(source, personal)).rejects.toThrow(
        /MCP server “address-\d\/search” /,
      );
    expect((await loadPluginDirectory(plain, personal)).mcpServers).toEqual([
      expect.objectContaining({ url: "https://search.example/mcp?region=eu" }),
    ]);
  });

  it("reads the request rate a connector declares, and refuses one that is not a positive number", async () => {
    const parent = await temporaryRoot("request-rate");
    const paced = await writePackage(parent, {
      mcp: { requestsPerMinute: 100 },
    });
    const invalid = await Promise.all(
      [0, -5, "fast", 1.5].map((requestsPerMinute, index) =>
        writePackage(parent, {
          name: `invalid-rate-${index}`,
          mcp: { requestsPerMinute },
        }),
      ),
    );

    expect((await loadPluginDirectory(paced, personal)).mcpServers).toEqual([
      expect.objectContaining({ requestsPerMinute: 100 }),
    ]);
    for (const source of invalid)
      await expect(loadPluginDirectory(source, personal)).rejects.toThrow(
        /requests per minute/i,
      );
  });

  it("reads the minutes a connector gives a slow tool, and refuses any but whole minutes from 1 to 60", async () => {
    const parent = await temporaryRoot("tool-minutes");
    const slow = await writePackage(parent, {
      mcp: { toolMinutes: { research: 16 } },
    });
    const invalid = await Promise.all(
      [
        ["research"],
        { research: 0 },
        { research: 61 },
        { research: 1.5 },
        { "": 5 },
      ].map((toolMinutes, index) =>
        writePackage(parent, {
          name: `invalid-minutes-${index}`,
          mcp: { toolMinutes },
        }),
      ),
    );

    expect((await loadPluginDirectory(slow, personal)).mcpServers).toEqual([
      expect.objectContaining({ toolMinutes: { research: 16 } }),
    ]);
    for (const source of invalid)
      await expect(loadPluginDirectory(source, personal)).rejects.toThrow(
        /tool minutes/i,
      );
  });

  it("reads which of a connector's tools its package says only read, and refuses a list that is not tool names", async () => {
    const parent = await temporaryRoot("read-only-tools");
    const declared = await writePackage(parent, {
      mcp: { readOnlyTools: ["search", "extract"] },
    });
    const invalid = await Promise.all(
      ["search", [""], [3], [" search"]].map((readOnlyTools, index) =>
        writePackage(parent, {
          name: `invalid-read-${index}`,
          mcp: { readOnlyTools },
        }),
      ),
    );

    expect((await loadPluginDirectory(declared, personal)).mcpServers).toEqual([
      expect.objectContaining({ readOnlyTools: ["search", "extract"] }),
    ]);
    for (const source of invalid)
      await expect(loadPluginDirectory(source, personal)).rejects.toThrow(
        /read-only tools/i,
      );
  });

  it("reads what a built-in package says each of its connector's tools does", async () => {
    const parent = await temporaryRoot("tool-effects");
    const toolEffects = [
      {
        tools: ["search"],
        effects: {
          reads: "none",
          changes: "none",
          sends: "service",
          actsAsPerson: "none",
          runs: "none",
          lasting: false,
          brings: "outside",
        },
      },
      {
        tools: ["comment", "label"],
        effects: {
          reads: "none",
          changes: "none",
          sends: "service",
          actsAsPerson: "once",
          runs: "none",
          lasting: false,
          brings: "outside",
        },
        destination: "{owner}/{repo}",
      },
    ];
    const declared = await writePackage(parent, { mcp: { toolEffects } });

    expect((await loadPluginDirectory(declared, SHIPPED)).mcpServers).toEqual([
      expect.objectContaining({ toolEffects }),
    ]);
  });

  it("reads why tools that change nothing are still kept from a read-only specialist", async () => {
    const parent = await temporaryRoot("reading-tools");
    const toolEffects = [
      {
        tools: ["list_library"],
        effects: {
          reads: "account",
          changes: "none",
          sends: "service",
          actsAsPerson: "none",
          runs: "none",
          lasting: false,
          brings: "outside",
        },
        notReadOnly: "It reads the person's own library.",
      },
    ];
    const declared = await writePackage(parent, { mcp: { toolEffects } });

    expect((await loadPluginDirectory(declared, SHIPPED)).mcpServers).toEqual([
      expect.objectContaining({ toolEffects }),
    ]);
  });

  it("refuses a list of read-only tools beside what the tools do, and a reason to withhold a tool that is not text", async () => {
    const parent = await temporaryRoot("reading-tools-invalid");
    const reads = {
      reads: "none",
      changes: "none",
      sends: "service",
      actsAsPerson: "none",
      runs: "none",
      lasting: false,
      brings: "outside",
    };
    const twice = await writePackage(parent, {
      name: "listed-twice",
      mcp: {
        readOnlyTools: ["search"],
        toolEffects: [{ tools: ["search"], effects: reads }],
      },
    });
    const unexplained = await Promise.all(
      ["", 3].map((notReadOnly, index) =>
        writePackage(parent, {
          name: `unexplained-${index}`,
          mcp: {
            toolEffects: [{ tools: ["search"], effects: reads, notReadOnly }],
          },
        }),
      ),
    );

    await expect(loadPluginDirectory(twice, SHIPPED)).rejects.toThrow(
      /read-only tools/i,
    );
    for (const source of unexplained)
      await expect(loadPluginDirectory(source, SHIPPED)).rejects.toThrow(
        /tool effects/i,
      );
  });

  it("refuses what a package says its connector's tools do unless the package is built in", async () => {
    const parent = await temporaryRoot("tool-effects-personal");
    const source = await writePackage(parent, {
      mcp: {
        toolEffects: [
          {
            tools: ["search"],
            effects: {
              reads: "none",
              changes: "none",
              sends: "service",
              actsAsPerson: "none",
              runs: "none",
              lasting: false,
              brings: "none",
            },
          },
        ],
      },
    });

    await expect(loadPluginDirectory(source, personal)).rejects.toThrow(
      /only built-in plugins/i,
    );
  });

  it("refuses a declaration of what tools do that leaves out a part, uses a word outside the vocabulary, or names a tool twice", async () => {
    const parent = await temporaryRoot("tool-effects-invalid");
    const whole = {
      reads: "none",
      changes: "none",
      sends: "service",
      actsAsPerson: "none",
      runs: "none",
      lasting: false,
      brings: "outside",
    };
    const withoutBrings = Object.fromEntries(
      Object.entries(whole).filter(([part]) => part !== "brings"),
    );
    const invalid = await Promise.all(
      [
        { tools: ["search"] },
        { tools: ["search"], effects: withoutBrings },
        { tools: ["search"], effects: { ...whole, sends: "anywhere" } },
        { tools: ["search"], effects: { ...whole, lasting: "no" } },
        { tools: ["search"], effects: { ...whole, extra: "none" } },
        { tools: ["search"], effects: { ...whole, carries: "everything" } },
        { tools: [], effects: whole },
        { tools: [" search"], effects: whole },
        { tools: ["search"], effects: whole, destination: "" },
        [
          { tools: ["search"], effects: whole },
          { tools: ["search"], effects: whole },
        ],
      ].map((group, index) =>
        writePackage(parent, {
          name: `invalid-effects-${index}`,
          mcp: { toolEffects: Array.isArray(group) ? group : [group] },
        }),
      ),
    );

    for (const source of invalid)
      await expect(loadPluginDirectory(source, SHIPPED)).rejects.toThrow(
        /tool effects/i,
      );
  });

  it("reads where a connector's key is made, and refuses a setup page Zhiyin may not open", async () => {
    const parent = await temporaryRoot("setup");
    const explained = await writePackage(parent, {
      mcp: {
        setup: {
          url: "https://app.tavily.com/home",
          keyName: "API key",
          advice: "Any key from your Tavily account works.",
        },
      },
    });
    const elsewhere = await writePackage(parent, {
      name: "elsewhere",
      mcp: {
        setup: { url: "https://example.com/keys", keyName: "API key" },
      },
    });
    const unnamed = await writePackage(parent, {
      name: "unnamed",
      mcp: { setup: { url: "https://app.tavily.com/home" } },
    });

    expect((await loadPluginDirectory(explained, personal)).mcpServers).toEqual(
      [
        expect.objectContaining({
          setup: {
            url: "https://app.tavily.com/home",
            keyName: "API key",
            advice: "Any key from your Tavily account works.",
          },
        }),
      ],
    );
    await expect(loadPluginDirectory(elsewhere, personal)).rejects.toThrow(
      /setup page must be one Zhiyin can open/i,
    );
    await expect(loadPluginDirectory(unnamed, personal)).rejects.toThrow(
      /key name/i,
    );
  });

  it("rejects paths outside the package and components this host cannot run", async () => {
    const parent = await temporaryRoot("containment");
    const escaping = await writePackage(parent, { logo: "../outside.png" });
    const hooks = await writePackage(parent, {
      name: "hooked-plugin",
      hooks: "./hooks/hooks.json",
    });

    await expect(loadPluginDirectory(escaping, personal)).rejects.toThrow(
      /stay inside the plugin root/i,
    );
    await expect(loadPluginDirectory(hooks, personal)).rejects.toThrow(
      /lifecycle hooks are not supported/i,
    );
  });
});

/**
 * Makes the list of installed plugins impossible to write, as a disk error
 * would, while it can still be read: a read-only file is not replaced. A
 * missing list is first written as the empty one the store reads it as. The
 * list as it was comes back with `unblock`.
 */
async function blockStateWrites(root: string): Promise<() => Promise<void>> {
  const state = join(root, "state.json");
  const existed = await readFile(state).then(
    () => true,
    () => false,
  );
  if (!existed) {
    await mkdir(root, { recursive: true });
    await writeFile(state, JSON.stringify({ version: 1, plugins: [] }));
  }
  await chmod(state, 0o444);
  return async () => {
    await chmod(state, 0o666);
    if (!existed) await rm(state);
  };
}

const unsaved = {
  code: "unavailable",
  message: "Installed plugins could not be saved.",
};

describe("durable plugin installation", () => {
  it("cleans up an install that failed part way, so it can be tried again at once", async () => {
    const root = await temporaryRoot("half-failed");
    const source = await writePackage(await temporaryRoot("half-sources"));
    const store = new FilePluginStore(root);
    await store.list();
    // The list of installed plugins cannot be written, once.
    const unblock = await blockStateWrites(root);

    await expect(store.install(source, personal)).rejects.toMatchObject(
      unsaved,
    );
    await unblock();

    await store.install(source, personal);
    expect((await store.list()).installed).toMatchObject([
      {
        activeVersion: "1.0.0",
        package: { manifest: { name: "research-helper" } },
      },
    ]);
  });

  it("leaves nothing beside the list of installed plugins when it cannot be saved", async () => {
    const root = await temporaryRoot("unsaved-list");
    const sources = await temporaryRoot("unsaved-sources");
    const store = new FilePluginStore(root);
    await store.install(await writePackage(sources), personal);
    const second = await writePackage(sources, { name: "citation-helper" });
    const state = join(root, "state.json");
    const before = await readdir(root);
    const listed = await readFile(state, "utf8");
    // A read-only file can be read but not replaced.
    await chmod(state, 0o444);

    try {
      await expect(store.install(second, personal)).rejects.toMatchObject({
        code: "unavailable",
        message: "Installed plugins could not be saved.",
      });
    } finally {
      await chmod(state, 0o666);
    }

    expect((await readdir(root)).sort()).toEqual(before.sort());
    expect(await readFile(state, "utf8")).toBe(listed);
  });

  it("refuses a second package with an identity already installed", async () => {
    const root = await temporaryRoot("collisions");
    const sources = await temporaryRoot("collision-sources");
    const first = await writePackage(sources);
    const duplicate = await writePackage(sources, {
      version: "2.0.0",
      description: "A different package using the same identity.",
    });
    const store = new FilePluginStore(root);

    await store.install(first, personal);

    await expect(store.install(duplicate, personal)).rejects.toMatchObject({
      code: "collision",
    });
  });

  it("installs only personal packages", async () => {
    const store = new FilePluginStore(await temporaryRoot("sources-only"));
    const source = await writePackage(await temporaryRoot("built-in-source"));

    await expect(
      store.install(source, { source: "built-in", sourceId: "shipped" }),
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  it("serializes concurrent durable mutations without losing packages", async () => {
    const root = await temporaryRoot("serialized");
    const sources = await temporaryRoot("serialized-sources");
    const store = new FilePluginStore(root);
    const packages = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        writePackage(sources, { name: `plugin-${index}` }),
      ),
    );

    await Promise.all(
      packages.map((source, index) =>
        store.install(source, {
          source: "personal",
          sourceId: `local-import/plugin-${index}`,
        }),
      ),
    );

    const restarted = new FilePluginStore(root);
    expect(
      (await restarted.list()).installed.map(
        (item) => item.package.manifest.name,
      ),
    ).toEqual(Array.from({ length: 8 }, (_, index) => `plugin-${index}`));
  });

  it("recovers an interrupted install without advertising partial files", async () => {
    const root = await temporaryRoot("interrupted-install");
    const source = await writePackage(await temporaryRoot("install-source"));
    const store = new FilePluginStore(root);
    const unblock = await blockStateWrites(root);

    await expect(store.install(source, personal)).rejects.toMatchObject(
      unsaved,
    );
    await unblock();

    const restarted = new FilePluginStore(root);
    expect((await restarted.list()).installed).toEqual([]);
    await expect(
      readFile(
        join(root, "packages", "research-helper", "1.0.0", "plugin.json"),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("updates atomically and can roll back to the last complete version", async () => {
    const root = await temporaryRoot("rollback");
    const sources = await temporaryRoot("rollback-sources");
    const first = await writePackage(sources, { version: "1.0.0" });
    const second = await writePackage(sources, {
      version: "2.0.0",
      description: "Research with a revised workflow.",
    });
    const store = new FilePluginStore(root);
    await store.install(first, personal);

    await store.update("research-helper", second);

    expect((await store.list()).installed).toMatchObject([
      {
        activeVersion: "2.0.0",
        rollbackVersion: "1.0.0",
        package: {
          manifest: { description: "Research with a revised workflow." },
        },
      },
    ]);
    await store.rollback("research-helper");
    expect((await new FilePluginStore(root).list()).installed).toMatchObject([
      {
        activeVersion: "1.0.0",
        rollbackVersion: "2.0.0",
        package: {
          manifest: { description: "Research with primary sources." },
        },
      },
    ]);
  });

  it("recovers an interrupted update to the previously active version", async () => {
    const root = await temporaryRoot("interrupted-update");
    const sources = await temporaryRoot("update-sources");
    const first = await writePackage(sources, { version: "1.0.0" });
    const second = await writePackage(sources, { version: "2.0.0" });
    const store = new FilePluginStore(root);
    await store.install(first, personal);
    const unblock = await blockStateWrites(root);

    const failed = await store
      .update("research-helper", second)
      .catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(PluginStoreError);
    expect(failed).toMatchObject(unsaved);
    await unblock();

    const recovered = (await new FilePluginStore(root).list()).installed;
    expect(recovered).toMatchObject([{ activeVersion: "1.0.0" }]);
    expect(recovered[0]).not.toHaveProperty("rollbackVersion");
  });

  it("removes personal packages but keeps built-in ownership outside the store", async () => {
    const root = await temporaryRoot("remove");
    const source = await writePackage(await temporaryRoot("remove-source"));
    const store = new FilePluginStore(root);
    await store.install(source, personal);

    await store.remove("research-helper");

    expect((await new FilePluginStore(root).list()).installed).toEqual([]);
    await expect(store.remove("software-engineering")).rejects.toMatchObject({
      code: "notFound",
    });
  });
});

describe("packages as people write them", () => {
  it("refuses a package holding a link, one leading out included, and a plugin UI app, and installs nothing", async () => {
    const parent = await temporaryRoot("links");
    const outside = await temporaryRoot("links-outside");
    await writeFile(join(outside, "notes.md"), "Outside the package.");
    const linkedOut = await writePackage(parent, { name: "linked-out" });
    await symlink(outside, join(linkedOut, "references"), "junction");
    const linkedSkill = await writePackage(parent, {
      name: "linked-skill",
      skill: "none",
    });
    await mkdir(join(linkedSkill, "skills"));
    await symlink(
      join(
        await writePackage(parent, { name: "real-skill" }),
        "skills",
        "research",
      ),
      join(linkedSkill, "skills", "research"),
      "junction",
    );
    const withApp = await writePackage(parent, { name: "with-app" });
    const manifest = JSON.parse(
      await readFile(join(withApp, "plugin.json"), "utf8"),
    ) as Record<string, unknown>;
    await writeFile(
      join(withApp, "plugin.json"),
      JSON.stringify({
        ...manifest,
        extensions: { "com.openai": { apps: { main: "./app/index.html" } } },
      }),
    );
    const root = await temporaryRoot("links-store");
    const store = new FilePluginStore(root);

    for (const source of [linkedOut, linkedSkill])
      await expect(store.install(source, personal)).rejects.toThrow(
        "Plugin packages may not contain symbolic links.",
      );
    await expect(store.install(withApp, personal)).rejects.toThrow(
      "Plugin UI apps are not supported by this Zhiyin build.",
    );
    expect((await store.list()).installed).toEqual([]);
  });

  it.each([
    ["1.0.0-beta.1", "1.0.0"],
    ["1.0.0-beta.9", "1.0.0-beta.10"],
    ["1.0.0-alpha", "1.0.0-alpha.1"],
    ["1.0.0-1", "1.0.0-alpha"],
    ["1.9.0", "1.10.0"],
  ])("updates %s to %s, the newer by semantic versioning", async (from, to) => {
    const root = await temporaryRoot("semver");
    const sources = await temporaryRoot("semver-sources");
    const store = new FilePluginStore(root);
    await store.install(
      await writePackage(sources, { version: from }),
      personal,
    );

    await store.update(
      "research-helper",
      await writePackage(sources, { version: to }),
    );

    expect((await store.list()).installed).toMatchObject([
      { activeVersion: to },
    ]);
  });

  it.each([
    ["1.0.0", "1.0.0-rc.1"],
    ["1.0.0-beta.10", "1.0.0-beta.9"],
    ["1.0.0+build.1", "1.0.0+build.2"],
  ])("refuses to update %s to %s, which is not newer", async (from, to) => {
    const root = await temporaryRoot("semver-older");
    const sources = await temporaryRoot("semver-older-sources");
    const store = new FilePluginStore(root);
    await store.install(
      await writePackage(sources, { version: from }),
      personal,
    );

    await expect(
      store.update(
        "research-helper",
        await writePackage(sources, { version: to }),
      ),
    ).rejects.toThrow(
      "An update must have a newer version than the installed plugin.",
    );
    expect((await store.list()).installed).toMatchObject([
      { activeVersion: from },
    ]);
  });

  it.each([
    [
      "a plain one",
      "description: Find and compare primary sources,\n  then report where they disagree.",
    ],
    [
      "a quoted one",
      'description: "Find and compare primary sources,\n  then report where they disagree."',
    ],
  ])(
    "loads a skill description that wraps onto a second line, %s, whole",
    async (_, line) => {
      const root = await writePackage(await temporaryRoot("wrapped"), {
        skill: "none",
      });
      await mkdir(join(root, "skills", "research"), { recursive: true });
      await writeFile(
        join(root, "skills", "research", "SKILL.md"),
        `---\nname: research\n${line}\nmetadata:\n  author: someone\n---\n\nOpen the sources.\n`,
        "utf8",
      );

      const loaded = await loadPluginDirectory(root, personal);

      expect(loaded.skills).toMatchObject([
        {
          description:
            "Find and compare primary sources, then report where they disagree.",
        },
      ]);
    },
  );

  /** A package holding the skills given, each as its SKILL.md's text. */
  async function packageOfSkills(
    label: string,
    skills: Readonly<Record<string, string>>,
    stages: readonly string[] = ["block-out", "model"],
  ): Promise<string> {
    const root = await writePackage(await temporaryRoot(label), {
      skill: "none",
      stages,
    });
    for (const [name, text] of Object.entries(skills)) {
      await mkdir(join(root, "skills", name), { recursive: true });
      await writeFile(join(root, "skills", name, "SKILL.md"), text, "utf8");
    }
    return root;
  }

  it("reads the skills a skill says it needs and works with, by their ids, from its metadata", async () => {
    const root = await packageOfSkills("needs", {
      layout: "---\nname: layout\ndescription: Lay it out.\n---\n\nLay out.\n",
      printing: [
        "---",
        "name: printing",
        "description: Print parts.",
        "metadata:",
        "  needs: layout",
        "  works-with: publishing/typesetting layout-review",
        "---",
        "",
        "Print it.",
      ].join("\n"),
      "layout-review":
        "---\nname: layout-review\ndescription: Review.\n---\n\nReview.\n",
    });

    const loaded = await loadPluginDirectory(root, personal);

    expect(
      loaded.skills.find((skill) => skill.id === "research-helper/printing"),
    ).toEqual({
      id: "research-helper/printing",
      name: "printing",
      description: "Print parts.",
      instructions: "Print it.",
      // A name alone is a skill of the same plugin.
      needs: ["research-helper/layout"],
      worksWith: ["publishing/typesetting", "research-helper/layout-review"],
    });
    expect(
      loaded.skills.find((skill) => skill.id === "research-helper/layout"),
    ).not.toHaveProperty("needs");
  });

  it.each([
    ["a skill its plugin does not hold", "needs: layot", "“layot”"],
    ["itself", "works-with: printing", "itself"],
    ["a name that is not portable", "needs: Lay_Out", "“Lay_Out”"],
  ])("refuses a skill that says it needs %s", async (_, line, named) => {
    const root = await packageOfSkills("bad-needs", {
      layout: "---\nname: layout\ndescription: Lay it out.\n---\n\nLay.\n",
      printing: `---\nname: printing\ndescription: Print.\nmetadata:\n  ${line}\n---\n\nPrint.\n`,
    });

    await expect(loadPluginDirectory(root, personal)).rejects.toThrow(named);
  });

  it("reads a skill's stages, domains and gate from its metadata, a gate wrapped onto a second line whole", async () => {
    const root = await packageOfSkills("stages", {
      lathe: [
        "---",
        "name: lathe",
        "description: Turn a profile.",
        "metadata:",
        "  stage: block-out, model",
        "  domain: product 工业设计",
        "  gate: Every turned part is a closed solid,",
        "    its wall as thick as the real one.",
        "  works-with: layout",
        "---",
        "",
        "Turn it.",
      ].join("\n"),
      layout: "---\nname: layout\ndescription: Lay it out.\n---\n\nLay out.\n",
    });

    const loaded = await loadPluginDirectory(root, personal);

    expect(
      loaded.skills.find((skill) => skill.id === "research-helper/lathe"),
    ).toMatchObject({
      stages: ["block-out", "model"],
      domains: ["product", "工业设计"],
      gate: "Every turned part is a closed solid, its wall as thick as the real one.",
      worksWith: ["research-helper/layout"],
    });
    const plain = loaded.skills.find(
      (skill) => skill.id === "research-helper/layout",
    );
    for (const field of ["stages", "domains", "gate"])
      expect(plain).not.toHaveProperty(field);
  });

  it("reads metadata past blank lines inside an entry, and domains written in any script", async () => {
    const root = await packageOfSkills("stages", {
      lathe: [
        "---",
        "name: lathe",
        "description: Turn a profile.",
        "metadata:",
        "  note: |",
        "    First paragraph.",
        "",
        "    Second paragraph.",
        "",
        "  stage: model",
        "  domain: コーヒー उत्पाद",
        "---",
        "",
        "Turn it.",
      ].join("\n"),
    });

    const loaded = await loadPluginDirectory(root, personal);

    expect(
      loaded.skills.find((skill) => skill.id === "research-helper/lathe"),
    ).toMatchObject({ stages: ["model"], domains: ["コーヒー", "उत्पाद"] });
  });

  it("takes a skill's stages from the ones its own plugin declares, whatever the studios name theirs", async () => {
    const root = await packageOfSkills(
      "own-stages",
      {
        tasting: `---\nname: tasting\ndescription: Taste.\nmetadata:\n  stage: roast, cup\n---\n\nTaste.\n`,
      },
      ["roast", "cup"],
    );
    const invalid = await Promise.all(
      ["roast", ["Roast"], [""], [3]].map(async (stages, index) =>
        writePackage(await temporaryRoot(`bad-stages-${index}`), { stages }),
      ),
    );

    expect(
      (await loadPluginDirectory(root, personal)).skills.find((skill) =>
        skill.id.endsWith("/tasting"),
      ),
    ).toMatchObject({ stages: ["roast", "cup"] });
    for (const source of invalid)
      await expect(loadPluginDirectory(source, personal)).rejects.toThrow(
        /stages/i,
      );
  });

  it.each([
    ["a stage its plugin does not declare", "stage: modelling", "“modelling”"],
    ["a domain that is not a word", "domain: product 3d/print", "“3d/print”"],
    ["a domain in capitals", "domain: Product", "“Product”"],
    [
      "a domain longer than a short word",
      `domain: ${"long".repeat(9)}`,
      `“${"long".repeat(9)}”`,
    ],
    [
      "a gate of more than one line",
      "gate: |\n    The part is valid.\n    It fits.",
      "one line",
    ],
    [
      "a gate longer than a sentence",
      `gate: ${"The part fits its neighbour. ".repeat(8)}`,
      "200",
    ],
  ])("refuses a skill whose metadata gives %s", async (_, line, reason) => {
    const root = await packageOfSkills("bad-stage", {
      printing: `---\nname: printing\ndescription: Print.\nmetadata:\n  ${line}\n---\n\nPrint.\n`,
    });

    await expect(loadPluginDirectory(root, personal)).rejects.toThrow(reason);
  });

  it.each([
    [
      "a plain one",
      "description: Find and compare primary sources,\n  then report where they disagree.\n\n  Use it when a claim needs checking.",
    ],
    [
      "a quoted one",
      'description: "Find and compare primary sources,\n  then report where they disagree.\n\n  Use it when a claim needs checking."',
    ],
  ])(
    "loads a skill description with a blank line inside it, %s, whole, and its instructions with theirs",
    async (_, line) => {
      const root = await writePackage(await temporaryRoot("paragraphs"), {
        skill: "none",
      });
      await mkdir(join(root, "skills", "research"), { recursive: true });
      await writeFile(
        join(root, "skills", "research", "SKILL.md"),
        `---\nname: research\n${line}\nmetadata:\n  author: someone\n---\n\nOpen the sources.\n\nThen compare what they say.\n`,
        "utf8",
      );

      const loaded = await loadPluginDirectory(root, personal);

      // As YAML folds it: lines join with a space, a blank line is a new line.
      expect(loaded.skills).toMatchObject([
        {
          description:
            "Find and compare primary sources, then report where they disagree.\nUse it when a claim needs checking.",
          instructions: "Open the sources.\n\nThen compare what they say.",
        },
      ]);
    },
  );

  it("reads a skill's frontmatter as YAML: comments, a folded block and a metadata map written inline", async () => {
    const root = await packageOfSkills("yaml", {
      lathe: [
        "---",
        "# Written by hand.",
        "name: lathe",
        "description: >-",
        "  Turn a profile",
        "  about an axis.",
        "metadata: { stage: model, domain: product } # inline",
        "license: MIT",
        "---",
        "",
        "Turn it.",
      ].join("\n"),
    });

    const loaded = await loadPluginDirectory(root, personal);

    expect(loaded.skills).toEqual([
      {
        id: "research-helper/lathe",
        name: "lathe",
        description: "Turn a profile about an axis.",
        instructions: "Turn it.",
        stages: ["model"],
        domains: ["product"],
      },
    ]);
  });

  it.each([
    [
      "is not YAML, saying the line and how to write a value holding a colon",
      "description: Use it: when a claim needs checking.",
      /line 3.*quotes/s,
    ],
    [
      "repeats a value by an alias",
      "description: &said Check claims.\nlicense: *said",
      /alias/,
    ],
    ["gives a value a tag", "description: !include notes.md", /tag/i],
    [
      "gives a key twice",
      "description: Check claims.\ndescription: Check them again.",
      /unique/,
    ],
    [
      "gives a metadata entry that is not text",
      "description: Check claims.\nmetadata:\n  stage: [model]",
      "“stage” must be text",
    ],
    ["is a list rather than a map", "- name\n- research", /map/],
  ])("refuses a skill whose frontmatter %s", async (_, frontmatter, reason) => {
    const root = await writePackage(await temporaryRoot("bad-yaml"), {
      skill: "none",
    });
    await mkdir(join(root, "skills", "research"), { recursive: true });
    await writeFile(
      join(root, "skills", "research", "SKILL.md"),
      frontmatter.startsWith("-")
        ? `---\n${frontmatter}\n---\n\nCheck.\n`
        : `---\nname: research\n${frontmatter}\n---\n\nCheck.\n`,
      "utf8",
    );

    await expect(loadPluginDirectory(root, personal)).rejects.toThrow(reason);
  });
});
