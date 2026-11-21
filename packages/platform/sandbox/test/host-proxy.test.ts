/**
 * The proxy a confined run goes out through, reached here from the test
 * itself as the person's own process may: what it tunnels, what it refuses,
 * which way it goes out, and what it counts. That only the run's container
 * can open it is shown in the confined runs' own tests.
 */

import { connect, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { dial, hopsOf, unreachableAddress } from "../src/egress/dial.js";
import { HostProxy } from "../src/egress/host-proxy.js";
import { hostEntries } from "../src/egress/hosts.js";
import { openLoopbackProxy } from "../src/index.js";
import {
  echoServer,
  httpUpstream,
  socksUpstream,
  type Upstream,
} from "./upstreams.js";

/** A SID no container has: the test, as the pipe's owner, opens it anyway. */
const noContainer = "S-1-15-2-1-2-3-4-5-6-7";

const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
});

async function proxyFor(
  hosts: readonly string[],
  route?: (url: string) => Promise<string>,
) {
  const entries = hostEntries(hosts);
  if (typeof entries === "string") throw new Error(entries);
  const proxy = await HostProxy.open({
    container: noContainer,
    hosts: entries,
    ...(route ? { route } : {}),
  });
  closing.push(() => proxy.close());
  return proxy;
}

async function upstream(made: Promise<Upstream>): Promise<Upstream> {
  const ready = await made;
  closing.push(() => ready.close());
  return ready;
}

/** A connection to the proxy's pipe, as the relay makes one. */
function toPipe(proxy: HostProxy): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ path: `\\\\.\\pipe\\${proxy.pipe}` });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

/** Sends `request` and answers what came back before the first pause. */
function exchange(socket: Socket, request: string): Promise<string> {
  return new Promise((resolve) => {
    let heard = "";
    const timer = setTimeout(() => resolve(heard), 1500);
    socket.on("data", (chunk) => {
      heard += chunk;
      if (heard.includes("\r\n\r\n") && !heard.startsWith("HTTP/1.1 200")) {
        clearTimeout(timer);
        resolve(heard);
      }
    });
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(heard);
    });
    socket.write(request);
  });
}

/** Opens a tunnel, then says `words` through it; answers both replies. */
async function tunnel(proxy: HostProxy, target: string, words: string) {
  const socket = await toPipe(proxy);
  const opened = await new Promise<string>((resolve) => {
    socket.once("data", (chunk) => resolve(String(chunk)));
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
  });
  const said = await new Promise<string>((resolve) => {
    socket.once("data", (chunk) => resolve(String(chunk)));
    socket.write(words);
  });
  socket.destroy();
  return { opened: opened.split("\r\n")[0], said };
}

/** An address of this computer on its network, which a run may reach. */
function networkAddress(): string {
  for (const addresses of Object.values(networkInterfaces()))
    for (const address of addresses ?? [])
      if (address.family === "IPv4" && !address.internal)
        return address.address;
  throw new Error("This computer has no network address to test with.");
}

describe("the network proxy of a confined run", () => {
  it("tunnels to an allowed host through the computer's HTTP proxy, and counts what went each way", async () => {
    const http = await upstream(httpUpstream());
    const proxy = await proxyFor(
      ["pypi.org"],
      async () => `PROXY 127.0.0.1:${http.port}`,
    );

    const { opened, said } = await tunnel(proxy, "pypi.org:443", "hello");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(opened).toBe("HTTP/1.1 200 Connection established");
    expect(said).toBe("pypi.org:443 heard hello");
    expect(http.asked).toEqual(["pypi.org:443"]);
    expect(proxy.reached()).toEqual([
      { host: "pypi.org", port: 443, connections: 1, sent: 5, received: 24 },
    ]);
  });

  it("goes through a SOCKS5 proxy when that is how the computer reaches the host", async () => {
    const socks = await upstream(socksUpstream());
    const proxy = await proxyFor(
      ["*.example.com"],
      async () => `SOCKS5 127.0.0.1:${socks.port}`,
    );

    const { opened, said } = await tunnel(proxy, "api.example.com:443", "hi");

    expect(opened).toBe("HTTP/1.1 200 Connection established");
    expect(said).toBe("api.example.com:443 heard hi");
    expect(socks.asked).toEqual(["api.example.com:443"]);
  });

  it("tries the next way the computer names when the first does not answer", async () => {
    const closed = await upstream(httpUpstream());
    await closed.close();
    const http = await upstream(httpUpstream());
    const proxy = await proxyFor(
      ["pypi.org"],
      async () =>
        `PROXY 127.0.0.1:${closed.port}; PROXY 127.0.0.1:${http.port}`,
    );

    const { said } = await tunnel(proxy, "pypi.org:443", "again");

    expect(said).toBe("pypi.org:443 heard again");
  });

  it("goes directly to the address a host has on this computer's network", async () => {
    const echo = await upstream(echoServer());
    const address = networkAddress();
    const proxy = await proxyFor([`${address}:${echo.port}`]);

    const { opened, said } = await tunnel(
      proxy,
      `${address}:${echo.port}`,
      "near",
    );

    expect(opened).toBe("HTTP/1.1 200 Connection established");
    expect(said).toBe("echo heard near");
  });

  it("refuses a host the run was not given, without asking the computer's proxy, and names it", async () => {
    const http = await upstream(httpUpstream());
    const proxy = await proxyFor(
      ["pypi.org"],
      async () => `PROXY 127.0.0.1:${http.port}`,
    );

    const answer = await exchange(
      await toPipe(proxy),
      "CONNECT evil.example:443 HTTP/1.1\r\n\r\n",
    );

    expect(answer).toContain("HTTP/1.1 403");
    expect(answer).toContain(
      "evil.example:443: not among the hosts this run may reach",
    );
    expect(http.asked).toEqual([]);
    expect(proxy.reached()).toEqual([
      {
        host: "evil.example",
        port: 443,
        connections: 0,
        sent: 0,
        received: 0,
        refused: "not among the hosts this run may reach",
      },
    ]);
  });

  it("refuses a request that is not an HTTPS tunnel, even to an allowed host", async () => {
    const proxy = await proxyFor(["pypi.org"]);

    const answer = await exchange(
      await toPipe(proxy),
      "GET http://pypi.org/simple HTTP/1.1\r\nHost: pypi.org\r\n\r\n",
    );

    expect(answer).toContain("HTTP/1.1 405");
    expect(proxy.reached()).toEqual([
      expect.objectContaining({
        host: "pypi.org",
        port: 80,
        refused: "only HTTPS is allowed",
      }),
    ]);
  });

  it("names a host it could not reach, with why", async () => {
    const closed = await upstream(httpUpstream());
    await closed.close();
    const proxy = await proxyFor(
      ["pypi.org"],
      async () => `PROXY 127.0.0.1:${closed.port}`,
    );

    const answer = await exchange(
      await toPipe(proxy),
      "CONNECT pypi.org:443 HTTP/1.1\r\n\r\n",
    );

    expect(answer).toContain("HTTP/1.1 502");
    expect(proxy.reached()).toEqual([
      expect.objectContaining({
        host: "pypi.org",
        connections: 0,
        failed: expect.any(String),
      }),
    ]);
  });

  it("names the first hundred hosts a run asks for and counts the requests to the rest", async () => {
    const proxy = await proxyFor(["pypi.org"]);

    const asked = 3000;
    for (let at = 0; at < asked; at += 50)
      await Promise.all(
        Array.from({ length: 50 }, async (_, index) =>
          exchange(
            await toPipe(proxy),
            `CONNECT host-${at + index}.example.com:443 HTTP/1.1\r\n\r\n`,
          ),
        ),
      );
    const again = await exchange(
      await toPipe(proxy),
      "CONNECT host-2999.example.com:443 HTTP/1.1\r\n\r\n",
    );

    expect(again).toContain("HTTP/1.1 403");
    const firstHundred = Array.from(
      { length: 100 },
      (_, index) => `host-${index}.example.com`,
    );
    expect(proxy.reached().map((reach) => reach.host)).toEqual(
      expect.arrayContaining(firstHundred),
    );
    expect(proxy.reached()).toHaveLength(100);
    expect(proxy.further()).toEqual({
      refused: 2901,
      failed: 0,
      connections: 0,
      sent: 0,
      received: 0,
    });
  }, 120_000);

  it("counts nothing further while a run asks for a hundred hosts or fewer", async () => {
    const proxy = await proxyFor(["pypi.org"]);

    await exchange(
      await toPipe(proxy),
      "CONNECT evil.example:443 HTTP/1.1\r\n\r\n",
    );

    expect(proxy.further()).toBeUndefined();
  });

  it("takes the relay's port from its first word only", async () => {
    const proxy = await proxyFor(["pypi.org"]);

    (await toPipe(proxy)).write("ZHIYIN-RELAY 41234\r\n\r\n");
    (await toPipe(proxy)).write("ZHIYIN-RELAY 1\r\n\r\n");

    expect(await proxy.relayPort()).toBe(41234);
  });
});

describe("where the proxy goes out", () => {
  it.each([
    ["127.0.0.1"],
    ["127.8.9.10"],
    ["::1"],
    ["::ffff:127.0.0.1"],
    ["0.0.0.0"],
    ["169.254.169.254"],
    ["fe80::1"],
  ])("never reaches %s", (address) => {
    expect(unreachableAddress(address)).toContain("no run reaches");
  });

  it.each([
    ["10.0.0.1"],
    ["192.168.1.1"],
    ["198.18.0.5"],
    ["151.101.0.223"],
    ["2001:db8::1"],
  ])("may reach %s", (address) => {
    expect(unreachableAddress(address)).toBeUndefined();
  });

  it("refuses to dial this computer even when the computer's proxy would take it", async () => {
    await expect(
      dial("127.0.0.1", 443, async () => "PROXY 127.0.0.1:9"),
    ).rejects.toThrow("no run reaches");
  });

  it("reads the ways a PAC answer names, in order, leaving out those it cannot use", () => {
    expect(
      hopsOf(
        "PROXY proxy.corp:8080; SOCKS 10.0.0.1:1080; HTTPS secure:443; SOCKS5 [::1]:1080; DIRECT",
      ),
    ).toEqual([
      { kind: "http", host: "proxy.corp", port: 8080 },
      { kind: "socks5", host: "::1", port: 1080 },
      { kind: "direct" },
    ]);
  });
});

describe("the proxy of a program run outside the container for a sealed-off run", () => {
  it("is reached on this computer's loopback, tunnels the hosts given and names the hosts it refused", async () => {
    const http = await upstream(httpUpstream());
    const proxy = await openLoopbackProxy(
      ["pypi.org"],
      async () => `PROXY 127.0.0.1:${http.port}`,
    );
    closing.push(() => proxy.close());
    const port = Number(new URL(proxy.address).port);
    const ask = async (target: string) => {
      const socket = await new Promise<Socket>((resolve, reject) => {
        const made = connect({ host: "127.0.0.1", port });
        made.once("connect", () => resolve(made));
        made.once("error", reject);
      });
      const heard = await exchange(
        socket,
        `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`,
      );
      socket.destroy();
      return heard.split("\r\n")[0];
    };

    expect(proxy.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(await ask("pypi.org:443")).toBe(
      "HTTP/1.1 200 Connection established",
    );
    expect(await ask("example.org:443")).toBe(
      "HTTP/1.1 403 example.org:443 refused",
    );
    expect(proxy.reached()).toContainEqual(
      expect.objectContaining({
        host: "example.org",
        port: 443,
        refused: "not among the hosts this run may reach",
      }),
    );
  });
});
