import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FilePluginStore,
  PluginStoreError,
  loadPluginDirectory,
} from "../src/index.js";

const roots: string[] = [];

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `zhiyin-plugin-${label}-`));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

type PackageOptions = {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  readonly hooks?: string;
  readonly logo?: string;
  readonly skill?: string;
  /** Adds a connector; an object adds these fields to its declaration. */
  readonly mcp?: boolean | Readonly<Record<string, unknown>>;
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
        ...(openai ? { extensions: { "com.openai": openai } } : {}),
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

describe("durable plugin installation", () => {
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

  it("installs only personal and marketplace packages", async () => {
    const store = new FilePluginStore(await temporaryRoot("sources-only"));
    const source = await writePackage(await temporaryRoot("project-source"));

    for (const provenance of [
      { source: "project", sourceId: "workspace" },
      { source: "built-in", sourceId: "shipped" },
    ] as const)
      await expect(store.install(source, provenance)).rejects.toMatchObject({
        code: "unsupported",
      });
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
          source: "marketplace",
          sourceId: `catalog/plugin-${index}`,
        }),
      ),
    );

    const restarted = new FilePluginStore(root);
    expect(
      (await restarted.list()).map((item) => item.package.manifest.name),
    ).toEqual(Array.from({ length: 8 }, (_, index) => `plugin-${index}`));
  });

  it("recovers an interrupted install without advertising partial files", async () => {
    const root = await temporaryRoot("interrupted-install");
    const source = await writePackage(await temporaryRoot("install-source"));
    const store = new FilePluginStore(root);
    await mkdir(join(root, "state.json.tmp"), { recursive: true });

    await expect(store.install(source, personal)).rejects.toMatchObject({
      code: "unavailable",
    });
    await rm(join(root, "state.json.tmp"), { recursive: true });

    const restarted = new FilePluginStore(root);
    expect(await restarted.list()).toEqual([]);
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

    expect(await store.list()).toMatchObject([
      {
        activeVersion: "2.0.0",
        rollbackVersion: "1.0.0",
        package: {
          manifest: { description: "Research with a revised workflow." },
        },
      },
    ]);
    await store.rollback("research-helper");
    expect(await new FilePluginStore(root).list()).toMatchObject([
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
    await mkdir(join(root, "state.json.tmp"), { recursive: true });

    await expect(store.update("research-helper", second)).rejects.toThrow(
      PluginStoreError,
    );
    await rm(join(root, "state.json.tmp"), { recursive: true });

    const recovered = await new FilePluginStore(root).list();
    expect(recovered).toMatchObject([{ activeVersion: "1.0.0" }]);
    expect(recovered[0]).not.toHaveProperty("rollbackVersion");
  });

  it("removes personal packages but keeps built-in ownership outside the store", async () => {
    const root = await temporaryRoot("remove");
    const source = await writePackage(await temporaryRoot("remove-source"));
    const store = new FilePluginStore(root);
    await store.install(source, personal);

    await store.remove("research-helper");

    expect(await new FilePluginStore(root).list()).toEqual([]);
    await expect(store.remove("software-engineering")).rejects.toMatchObject({
      code: "notFound",
    });
  });
});
