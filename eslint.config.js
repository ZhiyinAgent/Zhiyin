import { readdirSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX, { createNodeResolver } from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";
import { builtinRules } from "eslint/use-at-your-own-risk";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

function entriesOf(directory) {
  return readdirSync(new URL(`./${directory}`, import.meta.url), {
    withFileTypes: true,
  });
}

const foldersIn = (directory) =>
  entriesOf(directory)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

/*
 * Every workspace package sits in one layer and may import only the layers
 * below it (ADR 0002). Above the feature layer a package is used through its
 * interface, so only its types may be imported: a real implementation is
 * constructed in the composition root and handed in. A pure package computes
 * without I/O from the contract and other pure packages, and everything above
 * the contract, the window included, may use it whole (ADR 0002).
 *
 * Test helpers stand beside the layers rather than in them (ADR 0002): any
 * package's tests, and the code that runs only for them, may import one, and
 * nothing the app runs may. A test helper imports only the contract.
 *
 * A package others test against publishes the fakes of its own interfaces as
 * a second entry, `@zhiyin/<name>/testing` (ADR 0002). Only test code imports
 * one, and only where it may import the package itself; the code behind it
 * sits in the package's test folder and is held to the package's layer.
 *
 * A package's layer is the folder it sits in, `packages/<layer>/<name>`, so
 * the tree shows the layers and nothing else declares them (ADR 0002).
 */
const LAYERS = [
  "contract",
  "pure",
  "platform",
  "feature",
  "group",
  "loop",
  "core",
];
const TEST_HELPER = "test-helper";

/** The files a layer rule reads: every kind of TypeScript source. */
const code = "{ts,tsx,mts,cts}";

/**
 * Each package by name, with the layer whose folder holds it. A folder under
 * `packages` that is not a layer, or two packages of one name, stop lint.
 */
const packageLayers = new Map();
for (const layer of foldersIn("packages")) {
  if (![...LAYERS, TEST_HELPER].includes(layer))
    throw new Error(
      `packages/${layer} is not a layer. Each package sits in the folder of its layer, one of ${[...LAYERS, TEST_HELPER].join(", ")} (ADR 0002).`,
    );
  for (const name of foldersIn(`packages/${layer}`)) {
    if (packageLayers.has(name))
      throw new Error(
        `Two packages are named "${name}", in packages/${packageLayers.get(name)} and packages/${layer}.`,
      );
    packageLayers.set(name, layer);
  }
}

/**
 * The members each group presents as one and imports the types of. A group
 * reaches nothing else.
 */
const GROUP_MEMBERS = {
  capabilities: [
    "tools",
    "mcp",
    "toolchains",
    "plugins",
    "interactive-browser",
    "blender-studio",
  ],
  rewind: ["rewind-planner", "recovery"],
};

/*
 * Members a group presents without importing anything of theirs: the
 * composition root hands the group what they offer as a contract type, and the
 * group serves that. They are members all the same, so above the group they
 * are reached only through it; and the group, which has no need of them, may
 * not import them either. Each with the reason.
 */
const GROUP_MEMBERS_SERVED = {
  capabilities: {
    "git-connector":
      "Its git tools reach the model as a built-in connection: the group's gitConnection serves the OfferedConnection the composition root hands it.",
    "document-compiler":
      "Its compiling tools reach the model as a built-in connection: the group's documentsConnection serves the OfferedConnection the composition root hands it.",
    "python-sandbox":
      "Its Python tools reach the model as a built-in connection: the group's pythonConnection serves the OfferedConnection the composition root hands it.",
    "cad-studio":
      "Its CAD tools reach the model as a built-in connection: the group's cadConnection serves the OfferedConnection the composition root hands it, with the setup that makes its environment.",
  },
};

/** Every member of a group, imported or served. */
const membersOf = (group) => [
  ...(GROUP_MEMBERS[group] ?? []),
  ...Object.keys(GROUP_MEMBERS_SERVED[group] ?? {}),
];

const groupJoining = (member) =>
  [...packageLayers.keys()].find(
    (name) =>
      packageLayers.get(name) === "group" && membersOf(name).includes(member),
  );

/*
 * Above the group layer a member is reached through its group, so a caller
 * cannot go around the joining the group exists to do. Listed here are the
 * imports that are not what the group answers for, each with the reason — a
 * new one is a claim that the import is nothing the model can call, and has to
 * read as one.
 */
const MEMBER_IMPORTS_ALLOWED = {
  core: {
    "interactive-browser":
      "The browser panel a person watches and drives themselves. The capabilities group answers for what the model may call, and this is not that.",
    "blender-studio":
      "The 3D view a person watches and turns themselves. The capabilities group answers for what the model may call, and this is not that.",
  },
};

/**
 * A package outside the layers' folders would be held to no rule at all, so
 * asking for its layer stops lint instead of letting it slip through.
 */
export function layerOfPackage(name) {
  const layer = packageLayers.get(name);
  if (!layer)
    throw new Error(
      `The package "${name}" has no layer: put it in packages/<layer>/${name} before it can be linted (ADR 0002).`,
    );
  return layer;
}

/** Where a package's folder is, from the repository's root. */
const folderOf = (name) => `packages/${layerOfPackage(name)}/${name}`;

const workspacePackages = [...packageLayers.keys()];

const rankOf = (name) => LAYERS.indexOf(layerOfPackage(name));

const testHelpers = workspacePackages.filter(
  (name) => layerOfPackage(name) === TEST_HELPER,
);
const isPure = (name) => layerOfPackage(name) === "pure";
const purePackages = workspacePackages.filter(isPure);

/** Tests and the code that runs only for them. */
const testCode = [
  "**/*.test.{ts,tsx,mts,cts,mjs}",
  "**/test/**/*.{ts,tsx,mts,cts,mjs}",
  "**/system-boundary/**/*.{ts,tsx,mts,cts,mjs}",
  "apps/desktop/installed/**/*.{ts,tsx,mts,cts}",
];

const testHelperMessage =
  "Test helpers serve tests only: nothing the app runs imports one. Import it from a test, or from code that runs only for tests (ADR 0002).";

/** A package's fakes, which nothing the app runs may import. */
const testingEntry = {
  group: ["@zhiyin/*/testing"],
  message:
    "A testing entry holds a package's fakes, for tests: nothing the app runs imports one. Import it from a test, or from code that runs only for tests (ADR 0002).",
};

/** A `no-restricted-imports` rule that also refuses every testing entry. */
const withTestingRefused = ([level, { patterns = [], ...rest }]) => [
  level,
  { ...rest, patterns: [...patterns, testingEntry] },
];

const unreachableMessage = {
  contract:
    "The contract is the shared vocabulary and imports nothing from the workspace.",
  pure: "A pure package computes without I/O, so the window and every layer can use it: it imports only @zhiyin/contract and other pure packages (ADR 0002).",
  [TEST_HELPER]:
    "A test helper serves tests only and imports nothing from the workspace but @zhiyin/contract (ADR 0002).",
  platform:
    "Platform packages own operating-system mechanisms below features and depend only on @zhiyin/contract and pure packages.",
  feature:
    "Features are composed, never coupled. A feature may depend on @zhiyin/contract, pure packages and platform mechanisms, never another feature; a group, the agent loop or the core joins features together.",
  group:
    "A group joins its own members and nothing else but the pure packages every layer may use, and imports nothing of a member it serves through the contract. Anything more it needs is handed in by whoever composes it.",
  loop: "The agent loop does not import the core or another orchestrator; the core depends on the loop, not the reverse.",
  core: "The core does not import another orchestrator at its own level.",
};

/*
 * The contract and the pure packages run wherever they are imported, the
 * sandboxed window included, so their source names nothing but their own files
 * and workspace packages: no Node module, by either name, and no npm package,
 * whose code would then run in every layer (ADR 0002). Their tests may use the
 * test runner and Node.
 */
const runsAnywhereMessage =
  "The contract and pure packages compute without I/O, and code here runs wherever it is imported, the window included. Import only this package's own files, @zhiyin/contract and pure packages: never a Node module or an npm package (ADR 0002).";
const runsAnywhere = (layer) => ["contract", "pure"].includes(layer);

/*
 * The contract holds declarations: types, the command channels, constants and
 * value sets, which are data. A function body is logic, and logic goes to a
 * pure package or the feature that owns it, so the contract's source declares
 * no function, arrow function or method (ADR 0002).
 */
const declarationsOnly = [
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
].map((selector) => ({
  selector,
  message:
    "The contract holds declarations only: types, constants and value sets. Move this function to a pure package, or to the feature that owns it, and keep its types here (ADR 0002).",
}));

/**
 * The layer rule for one package's code. With `inTests`, for its tests and the
 * code that runs only for them, which alone may import a test helper; with
 * `source`, for the source of a package that runs anywhere; with `layerOnly`,
 * only which packages the layer reaches, for tests that may use real
 * implementations.
 */
function packageImportRule(
  name,
  { inTests = false, source = false, layerOnly = false } = {},
) {
  const layer = layerOfPackage(name);
  const others = workspacePackages.filter(
    (other) =>
      other !== name &&
      other !== "contract" &&
      !(inTests && testHelpers.includes(other)),
  );
  const reachable = others.filter((other) =>
    testHelpers.includes(other) || layer === TEST_HELPER
      ? false
      : layer === "group"
        ? (GROUP_MEMBERS[name] ?? []).includes(other) || isPure(other)
        : layer === "pure"
          ? isPure(other)
          : rankOf(other) < rankOf(name),
  );
  const unreachable = others.filter((other) => !reachable.includes(other));
  // Test helpers are refused for what they are, except where the layer's own
  // reason already refuses everything: in the contract and in a test helper.
  const refusedHelpers = ["contract", TEST_HELPER].includes(layer)
    ? []
    : unreachable.filter((other) => testHelpers.includes(other));
  const refusedByLayer = unreachable.filter(
    (other) => !refusedHelpers.includes(other),
  );
  // A member of a group this package sits above, reached without going through
  // the group and without a listed reason.
  const throughGroup =
    ["loop", "core"].includes(layer) && !layerOnly
      ? reachable.filter(
          (other) =>
            groupJoining(other) && !MEMBER_IMPORTS_ALLOWED[name]?.[other],
        )
      : [];
  // What may be imported only for its types: not a pure package, which every
  // layer uses whole, nor a feature's platform mechanisms.
  const direct = reachable.filter(
    (other) =>
      !throughGroup.includes(other) &&
      !isPure(other) &&
      !(layer === "feature" && layerOfPackage(other) === "platform"),
  );
  const patterns = [];
  if (layer === "contract" || refusedByLayer.length)
    patterns.push({
      group: (layer === "contract"
        ? ["contract", ...others]
        : refusedByLayer
      ).map((other) => `@zhiyin/${other}`),
      message: unreachableMessage[layer],
    });
  if (refusedHelpers.length)
    patterns.push({
      group: refusedHelpers.map((helper) => `@zhiyin/${helper}`),
      message: testHelperMessage,
    });
  for (const group of new Set(throughGroup.map(groupJoining)))
    patterns.push({
      group: throughGroup
        .filter((member) => groupJoining(member) === group)
        .map((member) => `@zhiyin/${member}`),
      message: `@zhiyin/${group} presents these features as one. Reach them through it, so nothing goes around the joining the group exists to do. An import the group does not answer for is listed with its reason in eslint.config.js.`,
    });
  if (direct.length && !layerOnly)
    patterns.push({
      group: direct.map((other) => `@zhiyin/${other}`),
      allowTypeImports: true,
      message:
        "Above the feature layer a package is used through its interface: import its types only. Real implementations are constructed in the composition root and handed in.",
    });
  if (source && runsAnywhere(layer))
    patterns.push({
      regex: "^(?!\\.\\.?/|@zhiyin/)",
      message: runsAnywhereMessage,
    });
  return ["error", { patterns }];
}

/*
 * A feature's tests are held to the feature's rule, because a feature must be
 * testable with nothing else present, and so are the contract's and a pure
 * package's. An orchestrator's tests may use real implementations: that is
 * what an integration test is for. Whatever a package's rule covers, its tests
 * there may also import the test helpers; the contract's may not, and import
 * nothing at all.
 *
 * The tests of a group, the loop and the core still reach only what their
 * layer reaches, testing entries included, so the fakes they publish or
 * compose from their test folders keep to their layer (ADR 0002). A platform
 * package publishes no fakes, and its tests may use the platform mechanisms
 * beside it.
 */
const testedAloneLayers = ["contract", "pure", "feature"];
const packageLayerRules = workspacePackages.flatMap((name) => {
  const layer = layerOfPackage(name);
  const covered = testedAloneLayers.includes(layer)
    ? `${folderOf(name)}/**/*.${code}`
    : `${folderOf(name)}/src/**/*.${code}`;
  const rule = (options) => ({
    "@typescript-eslint/no-restricted-imports": packageImportRule(
      name,
      options,
    ),
  });
  return [
    { files: [covered], rules: rule() },
    ...(["contract", TEST_HELPER].includes(layer)
      ? []
      : [
          {
            // Each entry is a pair, and a file must match both.
            files: testCode.map((tests) => [covered, tests]),
            rules: rule({ inTests: true }),
          },
        ]),
    ...(!["group", "loop", "core"].includes(layer)
      ? []
      : [
          {
            files: [
              `${folderOf(name)}/test/**/*.${code}`,
              `${folderOf(name)}/system-boundary/**/*.${code}`,
            ],
            rules: rule({ inTests: true, layerOnly: true }),
          },
        ]),
    ...(runsAnywhere(layer)
      ? [
          {
            files: [`${folderOf(name)}/src/**/*.${code}`],
            ignores: testCode,
            rules: rule({ source: true }),
          },
        ]
      : []),
  ];
});

const unseenImportMessages = {
  dynamic:
    "Import a workspace package with a static import, so the layer rules can see it.",
  inline:
    "Name another package's type through a top-level `import type`, so the layer rules can see it.",
  required:
    "A workspace package required at runtime escapes the layer rules. Import it instead.",
};

/**
 * Refuses a workspace package named where the layer rules cannot see it,
 * other than those `allowed` names.
 */
function unseenImports(allowed) {
  const named = `/^@zhiyin\\/(?!(?:${allowed.join("|")})(?![a-z-]))/`;
  return [
    "error",
    {
      selector: `ImportExpression[source.value=${named}]`,
      message: unseenImportMessages.dynamic,
    },
    {
      selector: `TSImportType[argument.literal.value=${named}]`,
      message: unseenImportMessages.inline,
    },
    {
      selector: `CallExpression[arguments.0.value=${named}]`,
      message: unseenImportMessages.required,
    },
  ];
}

const testedAlone = workspacePackages.filter((name) =>
  testedAloneLayers.includes(layerOfPackage(name)),
);
const platformPackages = workspacePackages.filter(
  (name) => layerOfPackage(name) === "platform",
);

/*
 * Inside the model client each provider is a folder of its own (ADR 0014). A
 * provider uses the wire formats and the shared client, never another
 * provider, so it can be read, changed or removed alone; and the shared code
 * reaches providers only through their one list, so none of it is written for
 * one provider. Built from the folders present, so a new provider is held to
 * this the day it appears.
 */
const modelProviders = "packages/feature/model-client/src/providers";
const modelProviderRules = [
  ...foldersIn(modelProviders).map((provider) => ({
    files: [`${modelProviders}/${provider}/**/*.${code}`],
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: repositoryRoot,
          zones: [
            {
              target: `${modelProviders}/${provider}`,
              from: modelProviders,
              except: [`./${provider}`],
              message:
                "A provider uses the wire formats and the shared client, never another provider or the list of providers (ADR 0014).",
            },
          ],
        },
      ],
    },
  })),
  {
    files: [`packages/feature/model-client/src/**/*.${code}`],
    ignores: [`${modelProviders}/**`],
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: repositoryRoot,
          zones: [
            {
              target: "packages/feature/model-client/src",
              from: modelProviders,
              except: ["./index.ts"],
              message:
                "The shared model client reaches providers only through their list in providers/index.ts (ADR 0014).",
            },
          ],
        },
      ],
    },
  },
];

/*
 * A length backstop, not a target. Structure comes from what a file is
 * responsible for; passing the backstop is a prompt to look at that, never an
 * instruction to split.
 */
const SOURCE_FILES = [
  `packages/*/*/src/**/*.${code}`,
  "apps/desktop/src/main/**/*.{ts,tsx,mts,cts}",
  "apps/desktop/src/preload/**/*.{ts,tsx,mts,cts}",
  "apps/desktop/src/drawing/**/*.{ts,tsx,mts,cts}",
  "apps/desktop/src/comparing/**/*.{ts,tsx,mts,cts}",
  "apps/desktop/src/renderer/ui/**/*.{ts,tsx,mts,cts}",
  // The demo stage and component lab are code too, held to the same backstop.
  "apps/desktop/src/renderer/demo/**/*.{ts,tsx,mts,cts}",
];
const sourceLineBackstop = 1000;
const contractLineLimit = 300;

/*
 * A file that does one job past its limit gets a raise here, with a reason
 * naming that job: why its parts change together and splitting it would not
 * be coherent. "It grew" is not a reason. Whoever adds a responsibility to a
 * raised file re-reads its reason.
 */
const CEILING_RAISES = {};

for (const [path, { max, reason }] of Object.entries(CEILING_RAISES)) {
  const limit = path.startsWith("packages/contract/contract/")
    ? contractLineLimit
    : sourceLineBackstop;
  if (!(max > limit) || typeof reason !== "string" || !reason.trim())
    throw new Error(
      `The ceiling raise for ${path} must exceed ${limit} lines and name the file's single job.`,
    );
}

export { sourceLineBackstop, contractLineLimit };

/*
 * The core rule's message says only that the file is too long, which reads as
 * "split it". ESLint publishes its core rules only through this entry point.
 */
const coreMaxLines = builtinRules.get("max-lines");
const responsibilityLines = {
  ...coreMaxLines,
  meta: {
    ...coreMaxLines.meta,
    messages: {
      exceed:
        "This file has {{actual}} lines of code; its ceiling is {{max}}. Review what this file is responsible for. Split it only where its responsibilities part. If it does one job and splitting it would not be coherent, raise this file's ceiling in CEILING_RAISES with the reason (docs/tooling.md).",
    },
  },
};
const zhiyin = { rules: { "max-lines": responsibilityLines } };

const lineLimit = (max) => [
  "error",
  { max, skipBlankLines: true, skipComments: true },
];

/** Another package is reached through its entry point, never its files. */
const throughEntryPoint = {
  group: ["@zhiyin/*/src/*", "@zhiyin/*/dist/*"],
  message:
    "Import a package by its name only. Its entry point is its public interface; everything else is internal.",
};

/**
 * A test's temporary folder comes from TemporaryFolders, which removes it, so
 * no run leaves folders in the system's temporary folder.
 */
const madeByTemporaryFolders = [
  ["node:fs", "fs"].map((name) => ({
    name,
    importNames: ["mkdtemp", "mkdtempSync", "promises", "default"],
  })),
  ["node:fs/promises", "fs/promises"].map((name) => ({
    name,
    importNames: ["mkdtemp", "default"],
  })),
]
  .flat()
  .map((path) => ({
    ...path,
    message:
      "Make a test's temporary folder with TemporaryFolders from @zhiyin/test-support, and remove it with removeAll once the test is over. Import other file functions by name.",
  }));

/*
 * The renderer's modules are read from the folders themselves, so a folder
 * added under `ui/` is held to the same rules the moment it exists. A list
 * kept by hand would fall behind and leave new modules unguarded.
 */
const renderer = "apps/desktop/src/renderer";

const codeFilesIn = (directory) =>
  entriesOf(directory)
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => `${directory}/${entry.name}`);

/** Whether anything under a folder is code, at any depth. */
const holdsCode = (directory) =>
  entriesOf(directory).some((entry) =>
    entry.isDirectory()
      ? holdsCode(`${directory}/${entry.name}`)
      : /\.tsx?$/.test(entry.name),
  );

const uiFolders = foldersIn(`${renderer}/ui`);
const rendererModules = uiFolders.filter(
  (name) => name !== "app" && name !== "shared",
);
const uiFolder = (name) => `${renderer}/ui/${name}`;

/** Every place in the renderer that can import something. */
const rendererPlaces = [
  ...uiFolders.map(uiFolder),
  // Every other folder in the renderer that holds code - the demo, and
  // anything added beside it - so a new one is held to the same entry points
  // the day it appears. A folder of images imports nothing and is not one.
  ...foldersIn(renderer)
    .filter((name) => name !== "ui" && holdsCode(`${renderer}/${name}`))
    .map((name) => `${renderer}/${name}`),
  ...codeFilesIn(renderer),
  ...codeFilesIn(`${renderer}/ui`),
  // Code beside the renderer, such as tests that draw its components, is held
  // to the same entry points as the renderer itself.
  ...codeFilesIn("apps/desktop/src"),
];
const placesExcept = (...excluded) =>
  rendererPlaces.filter((place) => !excluded.includes(place));

const rendererZones = [
  // A folder is used through its entry point. What it does not export is its
  // own business, and can change without anyone else noticing.
  ...uiFolders.map((name) => ({
    target: placesExcept(uiFolder(name)),
    from: uiFolder(name),
    except: ["./index.ts"],
    message: `Use ${name} through its index.ts. Everything else in it is private.`,
  })),
  // Modules meet only in the app shell, which passes one module's pieces into
  // another. A module that imports another has made that decision for it.
  ...rendererModules.map((name) => ({
    target: uiFolder(name),
    from: placesExcept(uiFolder(name), uiFolder("shared")),
    message:
      "A module does not import another module, the app shell, or the demo. The app shell composes modules and passes in what one needs from another.",
  })),
  {
    target: uiFolder("shared"),
    from: placesExcept(uiFolder("shared")),
    message:
      "Shared presentation holds neutral pieces and cannot depend on a module or the app shell.",
  },
  {
    target: renderer,
    from: ["apps/desktop/src/main", "apps/desktop/src/preload"],
    message:
      "The window reaches the core through the preload bridge, never by importing the main process or the bridge itself.",
  },
];

const rendererPackageRule = [
  "error",
  {
    patterns: [
      {
        group: [
          "@zhiyin/*",
          "!@zhiyin/contract",
          ...purePackages.map((name) => `!@zhiyin/${name}`),
        ],
        message:
          "The renderer reaches the core through the preload bridge, not by importing backend packages. It may use the contract and the pure packages (ADR 0002).",
      },
    ],
    paths: [
      {
        name: "electron",
        message:
          "The renderer has no Node or Electron access. Everything it can do comes through the preload bridge.",
      },
      // The renderer's tests are held to it here, as this rule replaces theirs.
      ...madeByTemporaryFolders,
    ],
  },
];

const drawingPackageRule = [
  "error",
  {
    patterns: [
      {
        group: ["@zhiyin/*", "!@zhiyin/document-viewer"],
        message:
          "The drawing process runs the document viewer's drawing service only.",
      },
    ],
    // Its tests are held to it here, as this rule replaces theirs. The
    // drawing process makes no folders either.
    paths: madeByTemporaryFolders,
  },
];

/**
 * TypeScript has no equivalent of a private module boundary, so the boundaries
 * the architecture depends on are enforced here instead. These rules are not
 * style: each one stands in for something a compiler would have caught.
 */
export default tseslint.config(
  // Evaluation fixtures are inputs, not source. One of them contains a
  // deliberate defect that the tooling must not tidy away, and they are written
  // in whatever style their case calls for. The trailer's production material
  // is kept out of the repository and holds third-party code. A worktree
  // Claude Code opens inside the repository is another checkout, linted there.
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/node_modules/**",
      "evaluation/**",
      "trailer/**",
      ".claude/worktrees/**",
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    plugins: { "import-x": importX },
    settings: {
      "import-x/extensions": [".ts", ".tsx", ".js", ".mjs"],
      // Source imports name the `.js` file TypeScript will emit. Without this
      // alias the path rules cannot find the `.ts` file behind the name, and a
      // rule that cannot resolve an import silently allows it.
      "import-x/resolver-next": [
        createNodeResolver({
          extensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
          extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
        }),
      ],
    },
    rules: {
      // Reaching into another package's internals. The closest thing we have
      // to "this item is private". Nor does code the app runs import a
      // package's fakes; the block for tests below lifts that.
      "no-restricted-imports": [
        "error",
        { patterns: [throughEntryPoint, testingEntry] },
      ],
      // A relative path that climbs out into a sibling package is the same
      // violation wearing a different hat.
      "import-x/no-relative-packages": "error",
      // The layer rules stop a cycle between packages. Inside one package
      // this rule does, and a cycle there is the first sign two files are one.
      // A library never imports this code back, so no cycle runs through one:
      // not following into libraries halves lint's memory (3.2 GB to 1.6 GB,
      // 2026-11-04), which outgrew a 7 GB runner.
      "import-x/no-cycle": ["error", { ignoreExternal: true }],
    },
  },

  {
    // Tests make their temporary folders through TemporaryFolders. This block
    // replaces the rule above for them, so it repeats that rule's pattern.
    files: testCode,
    ignores: ["packages/test-helper/test-support/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [throughEntryPoint], paths: madeByTemporaryFolders },
      ],
    },
  },

  ...packageLayerRules,

  ...modelProviderRules,

  {
    /*
     * The layer rules read import declarations, so a package named any other
     * way is a package they cannot see: a dynamic import, a type named inline,
     * or a name handed to a runtime require would each reach whatever the
     * layer forbids, and report nothing. The contract is the one package every
     * package may name.
     */
    files: [`packages/*/*/src/**/*.${code}`, `apps/desktop/src/**/*.${code}`],
    ignores: [`**/*.test.${code}`],
    rules: {
      "no-restricted-syntax": unseenImports(["contract"]),
    },
  },

  {
    // The app's own processes are code the app runs, so they import no test
    // helper either; their tests may.
    files: [`apps/desktop/src/**/*.${code}`],
    ignores: testCode,
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: testHelpers.map((helper) => `@zhiyin/${helper}`),
              message: testHelperMessage,
            },
          ],
        },
      ],
    },
  },

  /*
   * A package's tests are held to its own rule, the forms that rule cannot see
   * included, so a test cannot bring in another package around it. A feature's
   * tests may name its own package, the platform packages a feature uses, as
   * a stand-in does, and the test helpers; the contract's, only the contract.
   */
  ...testedAlone.map((name) => ({
    files: [
      `${folderOf(name)}/test/**/*.${code}`,
      `${folderOf(name)}/system-boundary/**/*.${code}`,
      `${folderOf(name)}/src/**/*.test.${code}`,
    ],
    rules: {
      "no-restricted-syntax": unseenImports(
        name === "contract"
          ? ["contract"]
          : isPure(name)
            ? ["contract", ...purePackages]
            : [
                "contract",
                name,
                ...platformPackages,
                ...purePackages,
                ...testHelpers,
              ],
      ),
    },
  })),

  // The contract and the pure packages name no Node module or npm package in
  // the forms the import rule cannot see either; and the contract's source
  // holds no function body.
  ...[false, true].map((contract) => ({
    files: workspacePackages
      .filter((name) => runsAnywhere(layerOfPackage(name)))
      .filter((name) => (layerOfPackage(name) === "contract") === contract)
      .map((name) => `${folderOf(name)}/src/**/*.${code}`),
    ignores: testCode,
    rules: {
      "no-restricted-syntax": [
        ...unseenImports(["contract"]),
        {
          selector:
            "ImportExpression[source.value=/^(?!\\.\\.?\\/|@zhiyin\\/)/]",
          message: runsAnywhereMessage,
        },
        {
          selector:
            "TSImportType[argument.literal.value=/^(?!\\.\\.?\\/|@zhiyin\\/)/]",
          message: runsAnywhereMessage,
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: runsAnywhereMessage,
        },
        ...(contract ? declarationsOnly : []),
      ],
    },
  })),

  {
    /*
     * Zhiyin goes online through the network the composition root hands in,
     * Chromium's in the app (ADR 0004). Node's own `fetch` reads neither
     * Windows' certificates nor its proxy settings, so it is named only where
     * a feature defaults to it when none is handed in.
     */
    files: [
      `packages/*/*/src/**/*.${code}`,
      `apps/desktop/src/main/**/*.${code}`,
    ],
    ignores: [
      `**/*.test.${code}`,
      "packages/feature/model-client/src/keyed-fetch.ts",
      "packages/feature/mcp/src/network.ts",
      "packages/feature/toolchains/src/network.ts",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "Go online through the network handed in (ADR 0004), not Node's own fetch.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "globalThis",
          property: "fetch",
          message:
            "Go online through the network handed in (ADR 0004), not Node's own fetch.",
        },
        {
          object: "global",
          property: "fetch",
          message:
            "Go online through the network handed in (ADR 0004), not Node's own fetch.",
        },
        {
          object: "window",
          property: "fetch",
          message:
            "Go online through the network handed in (ADR 0004), not Node's own fetch.",
        },
        {
          object: "self",
          property: "fetch",
          message:
            "Go online through the network handed in (ADR 0004), not Node's own fetch.",
        },
      ],
    },
  },

  {
    // The main process and the preload bridge carry messages between the
    // window and the core. The composition root is the one file that says
    // which implementation each part uses; nothing else here needs to import
    // what decides anything.
    files: [
      "apps/desktop/src/main/**/*.{ts,tsx,mts,cts}",
      "apps/desktop/src/preload/**/*.{ts,tsx,mts,cts}",
    ],
    ignores: ["apps/desktop/src/main/composition.ts", ...testCode],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@zhiyin/*", "!@zhiyin/contract"],
              message:
                "The main process and preload carry messages only. Construct parts in the composition root and put decisions in the core.",
            },
            testingEntry,
          ],
        },
      ],
    },
  },

  {
    // The window draws; the main process and the bridge carry messages. What
    // the window is made of is none of their business.
    files: [
      "apps/desktop/src/main/**/*.{ts,tsx,mts,cts}",
      "apps/desktop/src/preload/**/*.{ts,tsx,mts,cts}",
    ],
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: repositoryRoot,
          zones: [
            {
              target: ["apps/desktop/src/main", "apps/desktop/src/preload"],
              from: renderer,
              message:
                "The main process and the bridge carry messages; they do not import the window's own code.",
            },
          ],
        },
      ],
    },
  },

  {
    // The drawing process runs the document viewer's drawing service and
    // nothing else (ADR 0019): it reaches no other part of the app, the main
    // process, or the window.
    files: ["apps/desktop/src/drawing/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": drawingPackageRule,
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: repositoryRoot,
          zones: [
            {
              target: "apps/desktop/src/drawing",
              from: [
                renderer,
                "apps/desktop/src/main",
                "apps/desktop/src/preload",
              ],
              message:
                "The drawing process imports nothing from the main process, the bridge or the window.",
            },
          ],
        },
      ],
    },
  },

  {
    // The comparing thread runs the comparison of pixels and nothing
    // else: it reaches no other part of the app, the main process, or the
    // window, and decodes nothing.
    files: ["apps/desktop/src/comparing/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@zhiyin/(?!picture-comparison$)",
              message:
                "The comparing thread runs the comparison of pixels only.",
            },
          ],
          paths: madeByTemporaryFolders,
        },
      ],
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: repositoryRoot,
          zones: [
            {
              target: "apps/desktop/src/comparing",
              from: [
                renderer,
                "apps/desktop/src/main",
                "apps/desktop/src/preload",
                "apps/desktop/src/drawing",
              ],
              message:
                "The comparing thread imports nothing from the main process, the bridge, the drawing process or the window.",
            },
          ],
        },
      ],
    },
  },

  {
    files: [
      "apps/desktop/src/main/**/*.{ts,tsx,mts,cts}",
      "apps/desktop/src/drawing/**/*.{ts,tsx,mts,cts}",
      "apps/desktop/src/comparing/**/*.{ts,tsx,mts,cts}",
      "packages/**/*.{ts,tsx,mts,cts}",
    ],
    languageOptions: { globals: globals.node },
  },

  {
    // Real programs a test starts as its own process, so that containment can
    // be proved against processes rather than against a fake.
    files: ["packages/**/test/fixtures/**/*.{mjs,mts}"],
    languageOptions: { globals: globals.node },
  },

  {
    // A package's own scripts, run by hand with Node, such as the one that
    // writes the Python sandbox's locks.
    files: ["packages/**/scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },

  {
    // Gate scripts are Node programs that report to a terminal, so writing to
    // one is the point rather than a leftover debug line.
    files: ["scripts/**/*.{js,mjs}"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },

  {
    files: [`${renderer}/**/*.{ts,tsx}`],
    languageOptions: { globals: globals.browser },
    ...reactHooks.configs.flat["recommended-latest"],
    rules: {
      ...reactHooks.configs.flat["recommended-latest"].rules,
      // The renderer talks to the core through the preload bridge, never by
      // importing backend code or Electron directly.
      "no-restricted-imports": rendererPackageRule,
      "import-x/no-restricted-paths": [
        "error",
        { basePath: repositoryRoot, zones: rendererZones },
      ],
    },
  },

  // The window's and the drawing process's rules replace the one that keeps
  // testing entries out of code the app runs, for their tests too; it is
  // added back for the code they run (ADR 0002).
  {
    files: [`${renderer}/**/*.{ts,tsx}`],
    ignores: testCode,
    rules: { "no-restricted-imports": withTestingRefused(rendererPackageRule) },
  },
  {
    files: ["apps/desktop/src/drawing/**/*.{ts,tsx,mts,cts}"],
    ignores: testCode,
    rules: { "no-restricted-imports": withTestingRefused(drawingPackageRule) },
  },

  {
    files: SOURCE_FILES,
    ignores: ["**/*.test.{ts,tsx,mts,cts}"],
    plugins: { zhiyin },
    rules: { "zhiyin/max-lines": lineLimit(sourceLineBackstop) },
  },
  {
    // The contract is read by both sides of every boundary, so a file of it
    // is held well under the general limit.
    files: ["packages/contract/contract/src/**/*.{ts,tsx,mts,cts}"],
    ignores: ["**/*.test.{ts,tsx,mts,cts}"],
    rules: { "zhiyin/max-lines": lineLimit(contractLineLimit) },
  },
  {
    // A package's entry point is its public interface, so it lists what is
    // public and holds no implementation. Code placed there is imported back
    // from it by its neighbours, which is how a cycle starts.
    files: ["packages/*/*/src/index.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          "VariableDeclaration",
          "FunctionDeclaration",
          "ClassDeclaration",
          "TSTypeAliasDeclaration",
          "TSInterfaceDeclaration",
          "TSEnumDeclaration",
          "ExportDefaultDeclaration",
          "ExportNamedDeclaration[declaration]",
        ].map((kind) => ({
          selector: `Program > ${kind}`,
          message:
            "index.ts only re-exports. Put the declaration in a file named for what it is and export it from here.",
        })),
      ],
    },
  },
  ...Object.entries(CEILING_RAISES).map(([path, { max }]) => ({
    files: [path],
    rules: { "zhiyin/max-lines": lineLimit(max) },
  })),

  prettier,
);
