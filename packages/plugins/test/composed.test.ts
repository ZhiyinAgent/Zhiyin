import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ComposedPlugins,
  FilePluginSettings,
  FilePluginStore,
  PluginStoreError,
  loadBuiltInPlugins,
  type PluginView,
} from "../src/index.js";

const roots: string[] = [];

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(
    join(tmpdir(), `zhiyin-composed-plugin-${label}-`),
  );
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

type PackageSpec = {
  readonly name: string;
  readonly version?: string;
  readonly skills?: Readonly<Record<string, string>>;
  readonly specialists?: readonly { id: string; name: string }[];
  readonly servers?: readonly string[];
  readonly appConnectors?: readonly string[];
};

async function writePackage(root: string, spec: PackageSpec): Promise<string> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "plugin.json"),
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: spec.name,
      version: spec.version ?? "1.0.0",
      description: `The ${spec.name} package.`,
      extensions: {
        "com.zhiyin": {
          specialists: (spec.specialists ?? []).map((item) => ({
            ...item,
            description: `${item.name} handles one kind of task.`,
            instructions: `Act as ${item.name}.`,
          })),
          ...(spec.appConnectors
            ? {
                appConnectors: spec.appConnectors.map((connector) => ({
                  id: connector,
                  connector,
                  name: connector,
                  description: `The application's ${connector}.`,
                  access: "Runs on this computer.",
                  dataDestination: "Nothing leaves this computer.",
                })),
              }
            : {}),
        },
      },
    }),
    "utf8",
  );
  for (const [skill, instructions] of Object.entries(spec.skills ?? {})) {
    await mkdir(join(root, "skills", skill), { recursive: true });
    await writeFile(
      join(root, "skills", skill, "SKILL.md"),
      `---\nname: ${skill}\ndescription: Use ${skill}.\n---\n\n${instructions}\n`,
      "utf8",
    );
  }
  if (spec.servers?.length)
    await writeFile(
      join(root, "mcp.json"),
      JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: Object.fromEntries(
          spec.servers.map((server) => [
            server,
            { type: "streamable-http", url: `https://${server}.example/mcp` },
          ]),
        ),
      }),
      "utf8",
    );
  return root;
}

async function writeCatalog(
  directory: string,
  packages: readonly PackageSpec[],
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "catalog.json"),
    JSON.stringify({ plugins: packages.map((item) => item.name) }),
    "utf8",
  );
  for (const spec of packages)
    await writePackage(join(directory, spec.name), spec);
}

const engineering: PackageSpec = {
  name: "software-engineering",
  skills: { "test-first": "Write the failing test first." },
  specialists: [{ id: "code-reviewer", name: "Code reviewer" }],
  appConnectors: ["browser"],
};

async function setup(builtIns: readonly PackageSpec[] = [engineering]) {
  const catalog = join(await temporaryRoot("catalog"), "built-in");
  await writeCatalog(catalog, builtIns);
  const data = await temporaryRoot("data");
  const open = () =>
    new ComposedPlugins({
      builtIns: () => loadBuiltInPlugins(catalog),
      store: new FilePluginStore(join(data, "plugins")),
      settings: new FilePluginSettings(data),
    });
  return { plugins: open(), reopen: open, catalog };
}

const find = (plugins: readonly PluginView[], name: string) =>
  plugins.find((plugin) => plugin.manifest.name === name);

describe("a plugin directory composed of built-ins and installed packages", () => {
  it("lists built-ins first, then installed packages, all with namespaced components", async () => {
    const { plugins } = await setup();
    const source = await writePackage(await temporaryRoot("notes"), {
      name: "notes",
      skills: { summarize: "Summarize." },
      servers: ["search"],
    });

    await plugins.install(source);

    const listed = await plugins.list();
    expect(listed.map((plugin) => plugin.manifest.name)).toEqual([
      "software-engineering",
      "notes",
    ]);
    expect(find(listed, "software-engineering")).toMatchObject({
      provenance: { source: "built-in" },
      editing: "override",
      skills: [{ id: "software-engineering/test-first", enabled: true }],
      specialists: [{ id: "software-engineering/code-reviewer" }],
      appConnectors: [
        { id: "software-engineering/browser", connector: "browser" },
      ],
    });
    expect(find(listed, "notes")).toMatchObject({
      provenance: { source: "personal", sourceId: "local-import" },
      editing: "override",
      skills: [{ id: "notes/summarize" }],
      mcpServers: [{ id: "notes/search" }],
    });
  });

  it("refuses to install a package whose identity collides with a built-in", async () => {
    const { plugins } = await setup();
    const source = await writePackage(await temporaryRoot("impostor"), {
      name: "software-engineering",
    });

    await expect(plugins.install(source)).rejects.toMatchObject({
      code: "collision",
    });
  });

  it("refuses an installed package that names an application connector", async () => {
    const { plugins } = await setup();
    const source = await writePackage(await temporaryRoot("sneaky"), {
      name: "sneaky",
      appConnectors: ["browser"],
    });

    await expect(plugins.install(source)).rejects.toThrow(
      /only built-in plugins/i,
    );
    expect((await plugins.list()).map((p) => p.manifest.name)).toEqual([
      "software-engineering",
    ]);
  });

  it("keeps plugin and component switches across restarts", async () => {
    const { plugins, reopen } = await setup();

    await plugins.setEnabled("software-engineering", false);
    await plugins.setComponentEnabled(
      "software-engineering/code-reviewer",
      false,
    );

    const restarted = find(await reopen().list(), "software-engineering");
    expect(restarted?.enabled).toBe(false);
    expect(restarted?.specialists[0]?.enabled).toBe(false);
    expect(restarted?.skills[0]?.enabled).toBe(true);
  });

  it("refuses switches for plugins and components that do not exist", async () => {
    const { plugins } = await setup();

    await expect(plugins.setEnabled("missing", false)).rejects.toMatchObject({
      code: "notFound",
    });
    await expect(
      plugins.setComponentEnabled("software-engineering/missing", false),
    ).rejects.toMatchObject({ code: "notFound" });
  });

  it("updates, rolls back, and removes only non-built-in packages", async () => {
    const { plugins } = await setup();
    const parent = await temporaryRoot("versions");
    await plugins.install(
      await writePackage(join(parent, "1"), { name: "notes" }),
    );
    await plugins.update(
      "notes",
      await writePackage(join(parent, "2"), {
        name: "notes",
        version: "1.1.0",
      }),
    );

    expect(find(await plugins.list(), "notes")).toMatchObject({
      manifest: { version: "1.1.0" },
      rollbackVersion: "1.0.0",
    });
    await plugins.rollback("notes");
    expect(find(await plugins.list(), "notes")).toMatchObject({
      manifest: { version: "1.0.0" },
      rollbackVersion: "1.1.0",
    });
    await plugins.remove("notes");
    expect((await plugins.list()).map((p) => p.manifest.name)).toEqual([
      "software-engineering",
    ]);
  });

  it("refuses to update, roll back, or remove a built-in", async () => {
    const { plugins } = await setup();

    for (const attempt of [
      plugins.update("software-engineering", "/anywhere"),
      plugins.rollback("software-engineering"),
      plugins.remove("software-engineering"),
    ])
      await expect(attempt).rejects.toThrow(PluginStoreError);
  });

  it("forgets every choice about a removed plugin, so reinstalling starts fresh", async () => {
    const { plugins } = await setup();
    const source = await writePackage(await temporaryRoot("notes"), {
      name: "notes",
      skills: { summarize: "Summarize." },
    });
    await plugins.install(source);
    await plugins.setEnabled("notes", false);
    await plugins.setComponentEnabled("notes/summarize", false);
    await plugins.overrideComponent("notes/summarize", {
      description: "Summarize my way.",
      instructions: "Use bullet points.",
    });

    await plugins.remove("notes");
    await plugins.install(source);

    expect(find(await plugins.list(), "notes")).toMatchObject({
      enabled: true,
      skills: [
        {
          enabled: true,
          description: "Use summarize.",
          instructions: "Summarize.",
        },
      ],
    });
    expect(find(await plugins.list(), "notes")?.skills[0]).not.toHaveProperty(
      "override",
    );
  });
});

describe("editing a component a person did not write", () => {
  it("layers an edit over a built-in skill and resets back to the shipped content", async () => {
    const { plugins, reopen } = await setup();
    const id = "software-engineering/test-first";

    await plugins.overrideComponent(id, {
      description: "Use when changing behavior.",
      instructions: "Write the failing test, then the code.",
    });

    const edited = find(await reopen().list(), "software-engineering")
      ?.skills[0];
    expect(edited).toMatchObject({
      description: "Use when changing behavior.",
      instructions: "Write the failing test, then the code.",
      override: {
        shippedChanged: false,
        shipped: {
          description: "Use test-first.",
          instructions: "Write the failing test first.",
        },
      },
    });

    await plugins.resetComponent(id);
    const reset = find(await plugins.list(), "software-engineering")?.skills[0];
    expect(reset).toMatchObject({
      description: "Use test-first.",
      instructions: "Write the failing test first.",
    });
    expect(reset).not.toHaveProperty("override");
  });

  it("edits a built-in specialist's name as part of its content", async () => {
    const { plugins } = await setup();

    await plugins.overrideComponent("software-engineering/code-reviewer", {
      name: "Strict reviewer",
      description: "Reviews for correctness only.",
      instructions: "Report defects, not style.",
    });

    expect(
      find(await plugins.list(), "software-engineering")?.specialists[0],
    ).toMatchObject({
      id: "software-engineering/code-reviewer",
      name: "Strict reviewer",
      override: { shipped: { name: "Code reviewer" } },
    });
  });

  it("treats an edit identical to the shipped content as no edit", async () => {
    const { plugins } = await setup();

    await plugins.overrideComponent("software-engineering/test-first", {
      description: "Use test-first.",
      instructions: "Write the failing test first.",
    });

    expect(
      find(await plugins.list(), "software-engineering")?.skills[0],
    ).not.toHaveProperty("override");
  });

  it("keeps an edit when the shipped content changes, and says it changed", async () => {
    const { plugins, catalog, reopen } = await setup();
    await plugins.overrideComponent("software-engineering/test-first", {
      description: "Mine.",
      instructions: "My instructions.",
    });

    await writeCatalog(catalog, [
      { ...engineering, skills: { "test-first": "A revised shipped text." } },
    ]);

    const after = find(await reopen().list(), "software-engineering")
      ?.skills[0];
    expect(after).toMatchObject({
      instructions: "My instructions.",
      override: {
        shippedChanged: true,
        shipped: { instructions: "A revised shipped text." },
      },
    });
  });

  it("keeps an edit to an imported skill across an update that still declares it, and forgets one that no longer exists", async () => {
    const { plugins } = await setup();
    const parent = await temporaryRoot("imported");
    await plugins.install(
      await writePackage(join(parent, "1"), {
        name: "notes",
        skills: { keep: "Keep.", drop: "Drop." },
      }),
    );
    await plugins.overrideComponent("notes/keep", {
      description: "Edited keep.",
      instructions: "Edited.",
    });
    await plugins.overrideComponent("notes/drop", {
      description: "Edited drop.",
      instructions: "Edited.",
    });

    await plugins.update(
      "notes",
      await writePackage(join(parent, "2"), {
        name: "notes",
        version: "2.0.0",
        skills: { keep: "Keep, revised." },
      }),
    );
    expect(find(await plugins.list(), "notes")?.skills).toMatchObject([
      {
        id: "notes/keep",
        instructions: "Edited.",
        override: { shippedChanged: true },
      },
    ]);

    await plugins.rollback("notes");
    const rolledBack = find(await plugins.list(), "notes")?.skills;
    expect(rolledBack?.map((skill) => skill.id)).toEqual([
      "notes/drop",
      "notes/keep",
    ]);
    expect(rolledBack?.[0]).not.toHaveProperty("override");
    expect(rolledBack?.[1]).toMatchObject({ instructions: "Edited." });
  });

  it("refuses to layer edits over a connector or over a plugin made in the app", async () => {
    const { plugins } = await setup();
    await plugins.create("My Tools", "Things I use.");
    await plugins.saveContents("my-tools", {
      displayName: "My Tools",
      description: "Things I use.",
      skills: [{ id: "mine", description: "Mine.", instructions: "Do it." }],
      specialists: [],
      mcpServers: [],
    });

    await expect(
      plugins.overrideComponent("software-engineering/browser", {
        description: "x",
        instructions: "y",
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      plugins.overrideComponent("my-tools/mine", {
        description: "x",
        instructions: "y",
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
});

describe("plugins made in the app", () => {
  it("creates an empty plugin that is edited as a whole, one version per save", async () => {
    const { plugins, reopen } = await setup();

    await plugins.create("Weather Pro", "Weather tools.");
    await plugins.saveContents("weather-pro", {
      displayName: "Weather Pro",
      description: "Weather tools.",
      skills: [
        {
          id: "fetch-forecast",
          description: "Look up a forecast.",
          instructions: "Call the forecast tool.",
        },
      ],
      specialists: [
        {
          id: "route-planner",
          name: "Route planner",
          description: "Plans routes around weather.",
          instructions: "Avoid storms.",
        },
      ],
      mcpServers: [
        {
          id: "weather-api",
          name: "Weather API",
          description: "Live weather data.",
          url: "https://example.com/mcp",
        },
      ],
    });

    expect(find(await reopen().list(), "weather-pro")).toMatchObject({
      manifest: { version: "0.0.2", displayName: "Weather Pro" },
      provenance: { source: "personal", sourceId: "authored" },
      editing: "authored",
      skills: [{ id: "weather-pro/fetch-forecast" }],
      specialists: [{ id: "weather-pro/route-planner" }],
      mcpServers: [{ id: "weather-pro/weather-api" }],
    });
  });

  it("forgets the choices for a component removed by saving without it", async () => {
    const { plugins } = await setup();
    await plugins.create("Weather Pro", "Weather tools.");
    const withSkill = {
      displayName: "Weather Pro",
      description: "Weather tools.",
      skills: [
        { id: "forecast", description: "Forecast.", instructions: "Go." },
      ],
      specialists: [],
      mcpServers: [],
    };
    await plugins.saveContents("weather-pro", withSkill);
    await plugins.setComponentEnabled("weather-pro/forecast", false);

    await plugins.saveContents("weather-pro", { ...withSkill, skills: [] });
    await plugins.saveContents("weather-pro", withSkill);

    expect(find(await plugins.list(), "weather-pro")?.skills).toMatchObject([
      { id: "weather-pro/forecast", enabled: true },
    ]);
  });

  it("refuses to update an app-made plugin from a folder, or to edit an imported one as a whole", async () => {
    const { plugins } = await setup();
    await plugins.create("Weather Pro", "Weather tools.");
    const imported = await writePackage(await temporaryRoot("imported"), {
      name: "notes",
    });
    await plugins.install(imported);

    await expect(plugins.update("weather-pro", imported)).rejects.toMatchObject(
      { code: "unsupported" },
    );
    await expect(
      plugins.saveContents("notes", {
        displayName: "Notes",
        description: "Notes.",
        skills: [],
        specialists: [],
        mcpServers: [],
      }),
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  it("refuses a name that belongs to a built-in plugin", async () => {
    const { plugins } = await setup();

    await expect(
      plugins.create("Software Engineering", "Mine."),
    ).rejects.toMatchObject({ code: "collision" });
  });
});

describe("the built-in catalog", () => {
  it("loads the packages the catalog lists, in its order", async () => {
    const directory = join(await temporaryRoot("ordered"), "built-in");
    await writeCatalog(directory, [
      { name: "second-plugin" },
      { name: "first-plugin" },
    ]);

    expect(
      (await loadBuiltInPlugins(directory)).map((p) => p.manifest.name),
    ).toEqual(["second-plugin", "first-plugin"]);
  });

  it("refuses a package directory the catalog does not list, and a listed one that is missing", async () => {
    const unlisted = join(await temporaryRoot("unlisted"), "built-in");
    await writeCatalog(unlisted, [{ name: "listed" }]);
    await writePackage(join(unlisted, "stray"), { name: "stray" });
    const missing = join(await temporaryRoot("missing"), "built-in");
    await writeCatalog(missing, [{ name: "present" }]);
    await writeFile(
      join(missing, "catalog.json"),
      JSON.stringify({ plugins: ["present", "absent"] }),
      "utf8",
    );

    await expect(loadBuiltInPlugins(unlisted)).rejects.toThrow(/stray/);
    await expect(loadBuiltInPlugins(missing)).rejects.toThrow(/absent/);
  });
});
