import type { ConnectionTool } from "@zhiyin/contract";
import { spokenVersions } from "./environments.js";
import { duration, largestOutput } from "./programs.js";
import { maximumScriptBytes } from "./script-files.js";

const environmentChoice = {
  type: "string",
  description:
    "The environment, by name. Without it, the default one, which has pandas, polars, NumPy, SciPy, Matplotlib, seaborn, statsmodels and openpyxl.",
} as const;

const packages = {
  type: "array",
  items: { type: "string" },
  description:
    "Package names from pypi.org, optionally with a version specifier, such as plotly or numpy<2.",
} as const;

/**
 * The tools, with the time limits this sandbox keeps: a script's run, and each
 * step of installing packages or making an environment.
 */
export const toolsFor = (
  timeoutMs: number,
  prepareTimeoutMs: number,
): readonly ConnectionTool[] => [
  {
    name: "run_python",
    label: "Run a Python script",
    checksWork: "runs",
    description: `Run a Python script in one of Zhiyin's Python environments, with the workspace folder as its working directory. Give either code to run or the path of a script in the workspace. The script reads and changes only files in the workspace, and in the folders outside it named in outside_folders, which the person approves. Zhiyin copies the workspace and those folders before the script runs, so its changes there can be undone; a file it could not copy is read-only for the run, and the answer says so. Each run starts fresh: nothing a script defines or loads is kept for the next, so save to a file what a later run needs. A run stops after ${duration(timeoutMs)}. A run may print at most ${largestOutput / 1024 / 1024} MB: write more to a file. Its home folder (~) is Zhiyin's own for scripts, not the person's: write results in the workspace or a folder named in outside_folders. No window can open: to look at a figure, save it as a PNG in the workspace with savefig and read it with read_document. It runs in Zhiyin's environments, not a project's own virtual environment: run a project's own tests with bash. To discard a program's output, use subprocess.DEVNULL or os.devnull; a shell's own '> nul' is refused there.`,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python source to run." },
        path: {
          type: "string",
          description: `Workspace-relative path of a .py file to run instead, at most ${maximumScriptBytes / 1024 / 1024} MB.`,
        },
        arguments: {
          type: "array",
          items: { type: "string" },
          description: "Command-line arguments for the script.",
        },
        hosts: {
          type: "array",
          items: { type: "string" },
          description:
            "The hosts the script may reach, over HTTPS: names such as api.github.com, or *.example.com for every name below a domain, with :port for a port other than 443. Without hosts the script reaches no network and runs without asking. With them, every other host and plain HTTP are refused, and the answer says what each host was sent and sent back. requests, urllib, httpx and pip reach them through Zhiyin's proxy by themselves; a program that ignores HTTPS_PROXY reaches nothing. The person is asked once the conversation holds both outside content and something private, and may allow those hosts for the conversation.",
        },
        outside_folders: {
          type: "array",
          items: { type: "string" },
          description:
            "Whole paths of folders outside the workspace the script may also read and change, such as where the person keeps the files to work on. Zhiyin copies them before the script runs, as it does the workspace, and the person approves them, once for the conversation if they choose.",
        },
        change_locked: {
          type: "array",
          items: { type: "string" },
          description:
            "Files the script must change that Zhiyin made read-only for its run because it could not copy them first, as a run's answer names them: in the workspace by their path there, in an outside folder by their whole path. The change cannot be undone, so the person is asked; for a call naming one such file, they may allow changes to it for the conversation. Leave it out otherwise.",
        },
        environment: environmentChoice,
      },
      additionalProperties: false,
    },
  },
  {
    name: "install_python_package",
    label: "Add packages to a Python environment",
    description: `Add packages to one of Zhiyin's Python environments with its own pip. This changes only that environment, never a project's own. Each install stops after ${duration(prepareTimeoutMs)}.`,
    inputSchema: {
      type: "object",
      properties: {
        packages: { ...packages, minItems: 1 },
        environment: environmentChoice,
      },
      required: ["packages"],
      additionalProperties: false,
    },
  },
  {
    name: "create_python_environment",
    label: "Create a Python environment",
    description: `Create a Python environment of its own, for work that needs another Python version or packages that would clash with the default environment's. Environments are kept between conversations until removed. Each step of making it stops after ${duration(prepareTimeoutMs)}.`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Up to 32 lowercase letters, digits and dashes, starting with a letter.",
        },
        python: {
          type: "string",
          description: `The Python version: ${spokenVersions}. Without it, 3.13.`,
        },
        packages,
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "list_python_environments",
    label: "List the Python environments",
    description:
      "List Zhiyin's Python environments, with the Python version and the packages installed in each.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "remove_python_environment",
    label: "Remove a Python environment",
    description:
      "Delete one of Zhiyin's Python environments and everything installed in it. The default environment is reset instead.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The environment's name." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "reset_python_environment",
    label: "Rebuild a Python environment",
    description: `Delete one of Zhiyin's Python environments and build it again with the Python and packages it was made with. Packages added to it since are lost. Each step of making it stops after ${duration(prepareTimeoutMs)}.`,
    inputSchema: {
      type: "object",
      properties: { environment: environmentChoice },
      additionalProperties: false,
    },
  },
];
