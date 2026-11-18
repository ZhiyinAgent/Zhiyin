/**
 * Confined runs that name hosts, on real app containers: the program reaches
 * the hosts it is given through Zhiyin's proxy and its relay, and nothing
 * else, by no route. The computer's own proxy is a stand-in that answers for
 * every host, so no test reaches the internet.
 */

import { copyFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { networkOf } from "../src/confinement.js";
import { HostProxy } from "../src/egress/host-proxy.js";
import { hostEntries } from "../src/egress/hosts.js";
import {
  confine,
  forgetConfinement,
  openProcessContainer,
  runProcess,
  windowsEnvironment,
  type Confinement,
} from "../src/index.js";
import { httpUpstream, type Upstream } from "./upstreams.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const folders = new TemporaryFolders();
const kept = new TemporaryFolders();
const purpose = "test-network";
const homes: string[] = [];
let programs = "";
let upstream: Upstream;

beforeAll(async () => {
  programs = await kept.make("zhiyin-network-programs-");
  await copyFile(process.execPath, join(programs, "node.exe"));
  await copyFile(join(fixtures, "network.mjs"), join(programs, "network.mjs"));
  upstream = await httpUpstream();
});
afterEach(async () => {
  for (const each of homes.splice(0)) forgetConfinement(purpose, each);
  await folders.removeAll();
});
afterAll(async () => {
  await upstream.close();
  await kept.removeAll();
});

const node = ["--preserve-symlinks-main", "--preserve-symlinks"];

async function home(): Promise<string> {
  const made = await folders.make("zhiyin-network-home-");
  homes.push(made);
  return made;
}

/** Runs the fixture confined through `runProcess`, with the hosts given. */
async function run(
  hosts: readonly string[],
  operations: readonly (readonly unknown[])[],
) {
  const ran = await runProcess({
    executable: join(programs, "node.exe"),
    arguments: [
      ...node,
      join(programs, "network.mjs"),
      JSON.stringify(operations),
    ],
    cwd: programs,
    timeoutMs: 60_000,
    containment: {
      open: openProcessContainer,
      route: async () => `PROXY 127.0.0.1:${upstream.port}`,
    },
    environment: windowsEnvironment(),
    confinement: {
      purpose,
      home: await home(),
      read: [programs],
      write: [],
      hosts,
    },
  });
  if (ran.exitCode !== 0)
    throw new Error(
      `The run ended with ${ran.exitCode} ${ran.failure ?? ""}: ${ran.reason ?? ran.stderr}`,
    );
  return { results: JSON.parse(ran.stdout) as unknown[], network: ran.network };
}

/** What a program confined as `confinement` could do, started directly. */
async function launched(
  confinement: Confinement,
  operations: readonly (readonly unknown[])[],
) {
  const confined = await confine(confinement);
  const output = await folders.make("zhiyin-network-output-");
  const container = openProcessContainer();
  try {
    const child = container.launch({
      executable: join(programs, "node.exe"),
      arguments: [
        ...node,
        join(programs, "network.mjs"),
        JSON.stringify(operations),
      ],
      cwd: programs,
      stdout: join(output, "stdout.txt"),
      stderr: join(output, "stderr.txt"),
      confined,
    });
    await child.wait();
    return JSON.parse(
      await readFile(join(output, "stdout.txt"), "utf8"),
    ) as unknown[];
  } finally {
    container.close();
  }
}

describe("a confined run that names hosts", { timeout: 120_000 }, () => {
  it("reaches the hosts it is given through Zhiyin's proxy, and is told what it reached", async () => {
    const { results, network } = await run(
      ["pypi.org", "*.pythonhosted.org"],
      [
        ["tunnel", "pypi.org", 443, "simple"],
        ["tunnel", "files.pythonhosted.org", 443, "wheel"],
      ],
    );

    expect(results).toEqual([
      "HTTP/1.1 200 Connection established | pypi.org:443 heard simple",
      "HTTP/1.1 200 Connection established | files.pythonhosted.org:443 heard wheel",
    ]);
    expect(network).toEqual([
      { host: "pypi.org", port: 443, connections: 1, sent: 6, received: 25 },
      {
        host: "files.pythonhosted.org",
        port: 443,
        connections: 1,
        sent: 5,
        received: 38,
      },
    ]);
  });

  it("is refused every other host, and plain HTTP, each named in what it reached", async () => {
    const { results, network } = await run(
      ["pypi.org"],
      [
        ["tunnel", "example.com", 443, "x"],
        ["tunnel", "pypi.org", 8443, "x"],
        ["plain", "http://pypi.org/simple"],
      ],
    );

    expect(results).toEqual([
      "HTTP/1.1 403 example.com:443 refused",
      "HTTP/1.1 403 pypi.org:8443 refused",
      "HTTP/1.1 405 pypi.org:80 refused",
    ]);
    expect(
      network?.map(({ host, port, refused }) => [host, port, refused]),
    ).toEqual([
      ["example.com", 443, "not among the hosts this run may reach"],
      ["pypi.org", 8443, "not among the hosts this run may reach"],
      ["pypi.org", 80, "only HTTPS is allowed"],
    ]);
  });

  it("reaches nothing around the proxy: no address directly, and no name resolves", async () => {
    const { results } = await run(
      ["pypi.org"],
      [
        ["direct", "1.1.1.1", 443],
        ["direct", "127.0.0.1", upstream.port],
        ["resolve", "pypi.org"],
      ],
    );

    expect(results[0]).not.toBe("connected");
    expect(results[1]).not.toBe("connected");
    expect(results[2]).not.toMatch(/^\d/);
  });

  it("is told the relay's address, in place of any proxy Zhiyin's environment names", async () => {
    const { results } = await run(
      ["pypi.org"],
      [
        ["env", "HTTPS_PROXY"],
        ["env", "NO_PROXY"],
      ],
    );

    expect(results[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(results[1]).toBe("");
  });

  it("gets no proxy and says nothing reached when it names no hosts", async () => {
    const ran = await runProcess({
      executable: join(programs, "node.exe"),
      arguments: [
        ...node,
        join(programs, "network.mjs"),
        JSON.stringify([["env", "HTTPS_PROXY"]]),
      ],
      cwd: programs,
      timeoutMs: 60_000,
      containment: { open: openProcessContainer },
      environment: {
        ...windowsEnvironment(),
        HTTPS_PROXY: "http://proxy.corp:8080",
      },
      confinement: {
        purpose,
        home: await home(),
        read: [programs],
        write: [],
        hosts: [],
      },
    });

    expect(JSON.parse(ran.stdout)).toEqual([""]);
    expect(ran.network).toBeUndefined();
  });

  it("opens its proxy to its own container alone", async () => {
    const own = await home();
    const ownConfined = await confine({
      purpose,
      home: own,
      read: [programs],
      write: [],
      hosts: [],
    });
    const entries = hostEntries(["pypi.org"]);
    if (typeof entries === "string") throw new Error(entries);
    const proxy = await HostProxy.open({
      container: networkOf(ownConfined).container,
      hosts: entries,
    });
    try {
      const fromOwn = await launched(
        { purpose, home: own, read: [programs], write: [], hosts: [] },
        [["pipe", proxy.pipe]],
      );
      const fromAnother = await launched(
        { purpose, home: await home(), read: [programs], write: [], hosts: [] },
        [["pipe", proxy.pipe]],
      );

      expect(fromOwn).toEqual(["connected"]);
      expect(fromAnother).toEqual(["EPERM"]);
    } finally {
      await proxy.close();
    }
  });

  it("refuses to start with a host it cannot be given, saying why", async () => {
    const ran = await runProcess({
      executable: join(programs, "node.exe"),
      arguments: [],
      cwd: programs,
      timeoutMs: 60_000,
      containment: { open: openProcessContainer },
      confinement: {
        purpose,
        home: await home(),
        read: [programs],
        write: [],
        hosts: ["localhost"],
      },
    });

    expect(ran.failure).toBe("confinement");
    expect(ran.reason).toContain("this computer");
  });
});
