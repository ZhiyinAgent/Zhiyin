/**
 * The proxy every connection of Zhiyin's browser goes through (ADR 0018),
 * against real sockets: a request through it reaches its server or is
 * refused, and once the preview is asked for, only the preview and what was
 * allowed for it are reached. A loopback server stands in for a site on the
 * internet, made reachable here by the test's own rule for addresses.
 */

import {
  Agent,
  createServer,
  request,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";
import { connect, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { NetworkGate, reachable } from "../src/network-gate.js";

const servers: Server[] = [];
const gates: NetworkGate[] = [];
afterEach(async () => {
  await Promise.all(gates.splice(0).map((gate) => gate.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((done) => {
          server.closeAllConnections();
          server.close(done);
        }),
    ),
  );
});

/** A server answering who it is, and saying each request it was sent. */
async function site(name: string) {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.end(name);
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { port: (server.address() as AddressInfo).port, seen };
}

/**
 * A gate that looks names up as this test says, and lets the stand-in sites
 * on loopback be reached as a site on the internet would be.
 */
async function gate(names: Readonly<Record<string, number>> = {}) {
  const made = new NetworkGate({
    lookup: async (host) => (host in names ? "127.0.0.1" : host),
    reachable: (address) => address === "127.0.0.1",
  });
  gates.push(made);
  const port = await made.start();
  return { gate: made, port };
}

/** A GET of `url` through the proxy, as the browser sends one. */
function get(
  proxy: number,
  url: string,
  /** Headers the browser adds, which no page can set. */
  more: Readonly<Record<string, string>> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const asked = request(
      {
        host: "127.0.0.1",
        port: proxy,
        path: url,
        headers: { host: new URL(url).host, ...more },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => done({ status: res.statusCode ?? 0, body }));
      },
    );
    asked.on("error", fail);
    asked.end();
  });
}

/** A tunnel asked for through the proxy, as the browser asks for HTTPS: its answer line. */
function tunnel(proxy: number, to: string): Promise<string> {
  return new Promise((done, fail) => {
    const socket = connect(proxy, "127.0.0.1", () =>
      socket.write(`CONNECT ${to} HTTP/1.1\r\nHost: ${to}\r\n\r\n`),
    );
    socket.once("data", (data) => {
      done(data.toString().split("\r\n")[0]!);
      socket.destroy();
    });
    socket.on("error", fail);
  });
}

describe("the browser's proxy, before any preview", () => {
  it("passes a request on to the site it names", async () => {
    const shop = await site("shop");
    const { port } = await gate({ "shop.test": shop.port });

    expect(await get(port, `http://shop.test:${shop.port}/menu`)).toEqual({
      status: 200,
      body: "shop",
    });
    expect(shop.seen).toEqual(["GET /menu"]);
  });

  it("answers request after request on one connection, passing on none of the headers that belong to that connection", async () => {
    const sent: IncomingHttpHeaders[] = [];
    const shop = createServer((req, res) => {
      sent.push(req.headers);
      // Its own connection's headers, which are not the browser's.
      res.setHeader("Keep-Alive", "timeout=1");
      res.setHeader("Connection", "close");
      res.end("shop");
    });
    servers.push(shop);
    await new Promise<void>((done) => shop.listen(0, "127.0.0.1", done));
    const shopPort = (shop.address() as AddressInfo).port;
    const { port } = await gate({ "shop.test": shopPort });
    const oneConnection = new Agent({ keepAlive: true, maxSockets: 1 });

    const answers: { body: string; sameConnection: boolean }[] = [];
    for (const path of ["/a", "/b", "/c"])
      answers.push(
        await new Promise((done, fail) => {
          const asked = request(
            {
              agent: oneConnection,
              host: "127.0.0.1",
              port,
              path: `http://shop.test:${shopPort}${path}`,
              headers: {
                host: `shop.test:${shopPort}`,
                connection: "keep-alive, x-hop",
                "x-hop": "for the proxy only",
                "proxy-connection": "keep-alive",
                "keep-alive": "timeout=300",
                te: "trailers",
                "x-kept": "for the site",
              },
            },
            (res) => {
              let body = "";
              res.on("data", (chunk) => (body += chunk));
              res.on("end", () =>
                done({ body, sameConnection: asked.reusedSocket }),
              );
            },
          );
          asked.on("error", fail);
          asked.end();
        }),
      );
    oneConnection.destroy();

    expect(answers).toEqual([
      { body: "shop", sameConnection: false },
      { body: "shop", sameConnection: true },
      { body: "shop", sameConnection: true },
    ]);
    expect(sent.map((headers) => headers["x-kept"])).toEqual([
      "for the site",
      "for the site",
      "for the site",
    ]);
    const connectionsOwn = ["proxy-connection", "keep-alive", "te", "x-hop"];
    expect(
      sent.map((headers) => connectionsOwn.filter((name) => name in headers)),
    ).toEqual([[], [], []]);
  });

  it("opens a tunnel to the site it names", async () => {
    const shop = await site("shop");
    const { port } = await gate({ "shop.test": shop.port });

    expect(await tunnel(port, `shop.test:${shop.port}`)).toBe(
      "HTTP/1.1 200 Connection Established",
    );
  });

  it("stops reading from a site once the browser stops reading", async () => {
    let ended!: () => void;
    const closed = new Promise<void>((done) => (ended = done));
    const endless = createServer((_req, res) => {
      res.writeHead(200);
      const timer = setInterval(() => res.write(Buffer.alloc(64 * 1024)), 5);
      res.on("close", () => {
        clearInterval(timer);
        ended();
      });
    });
    servers.push(endless);
    await new Promise<void>((done) => endless.listen(0, "127.0.0.1", done));
    const { port } = await gate({ "files.test": 0 });
    const asked = request({
      host: "127.0.0.1",
      port,
      path: `http://files.test:${(endless.address() as AddressInfo).port}/big`,
    });
    asked.on("response", (res) => res.once("data", () => asked.destroy()));
    asked.on("error", () => undefined);
    asked.end();

    await closed;
  });

  it("says why it could not reach a site it was allowed to", async () => {
    const gone = createServer();
    await new Promise<void>((done) => gone.listen(0, "127.0.0.1", done));
    const closedPort = (gone.address() as AddressInfo).port;
    await new Promise((done) => gone.close(done));
    const { port } = await gate({ "gone.test": closedPort });

    const answer = await new Promise<{ status: number; reason: string }>(
      (done, fail) => {
        const asked = request(
          {
            host: "127.0.0.1",
            port,
            path: `http://gone.test:${closedPort}/`,
            headers: { host: `gone.test:${closedPort}` },
          },
          (res) => {
            res.resume();
            done({
              status: res.statusCode ?? 0,
              reason: res.statusMessage ?? "",
            });
          },
        );
        asked.on("error", fail);
        asked.end();
      },
    );

    expect(answer).toEqual({
      status: 502,
      reason: "Bad Gateway: ECONNREFUSED",
    });
  });

  it("refuses an address that is not reachable, sending it nothing", async () => {
    const local = await site("local");
    const made = new NetworkGate();
    gates.push(made);
    const port = await made.start();

    expect((await get(port, `http://127.0.0.1:${local.port}/`)).status).toBe(
      403,
    );
    expect(await tunnel(port, `localhost:${local.port}`)).toBe(
      "HTTP/1.1 403 Forbidden",
    );
    expect(local.seen).toEqual([]);
  });
});

/**
 * A page on this computer or its network, such as a development server, is
 * opened as before the proxy: when Zhiyin sends the browser there, and for
 * what that page asks of its own site, never for a website's page.
 */
describe("the browser's proxy and this computer", () => {
  async function localGate(
    pageAt: (hostPort: string) => boolean = () => false,
  ) {
    const made = new NetworkGate();
    gates.push(made);
    made.page(pageAt);
    return { gate: made, port: await made.start() };
  }

  it("opens a page on this computer the browser itself was sent to", async () => {
    const local = await site("dev server");
    const { port } = await localGate();

    expect(
      await get(port, `http://localhost:${local.port}/`, {
        "sec-fetch-site": "none",
      }),
    ).toEqual({ status: 200, body: "dev server" });
  });

  it("serves what a page on this computer asks of its own site, other ports included", async () => {
    const local = await site("api");
    const { port } = await localGate();

    for (const site of ["same-origin", "same-site"])
      expect(
        (
          await get(port, `http://127.0.0.1:${local.port}/data`, {
            "sec-fetch-site": site,
          })
        ).status,
        site,
      ).toBe(200);
  });

  it("serves what a page on this computer asks of another site on it", async () => {
    const local = await site("frame");
    const { port } = await localGate();

    for (const from of [
      { referer: "http://127.0.0.1:5173/" },
      { origin: "http://192.168.1.20:8080" },
    ])
      expect(
        (
          await get(port, `http://localhost:${local.port}/frame`, {
            "sec-fetch-site": "cross-site",
            ...from,
          })
        ).status,
        JSON.stringify(from),
      ).toBe(200);
  });

  it("refuses what a website's page asks of this computer", async () => {
    const local = await site("router");
    const { port } = await localGate();

    for (const from of [{}, { referer: "https://shop.example/cart" }])
      expect(
        (
          await get(port, `http://127.0.0.1:${local.port}/`, {
            "sec-fetch-site": "cross-site",
            ...from,
          })
        ).status,
        JSON.stringify(from),
      ).toBe(403);
    expect(local.seen).toEqual([]);
  });

  it("reaches a local address the browser does not say more of only while Zhiyin's page is at it", async () => {
    const local = await site("nas");
    const { port } = await localGate((at) => at === `127.0.0.1:${local.port}`);
    const other = await site("other");

    expect((await get(port, `http://127.0.0.1:${local.port}/`)).status).toBe(
      200,
    );
    expect(await tunnel(port, `127.0.0.1:${local.port}`)).toBe(
      "HTTP/1.1 200 Connection Established",
    );
    expect((await get(port, `http://127.0.0.1:${other.port}/`)).status).toBe(
      403,
    );
  });

  it("refuses a name that looks up to this computer, however it is asked for", async () => {
    const local = await site("rebound");
    const made = new NetworkGate({
      lookup: async (host) => (host === "rebind.test" ? "127.0.0.1" : host),
    });
    gates.push(made);
    made.page(() => true);
    const port = await made.start();

    expect(
      (
        await get(port, `http://rebind.test:${local.port}/`, {
          "sec-fetch-site": "same-origin",
        })
      ).status,
    ).toBe(403);
    expect(local.seen).toEqual([]);
  });

  it("reaches no address on this computer for the preview, even one allowed", async () => {
    const preview = await site("preview");
    const local = await site("dev server");
    const { gate: made, port } = await localGate(() => true);
    made.preview((at) => at === `127.0.0.1:${preview.port}`);
    made.allow([`http://127.0.0.1:${local.port}`]);
    await get(port, `http://127.0.0.1:${preview.port}/`);

    expect(
      (
        await get(port, `http://127.0.0.1:${local.port}/`, {
          "sec-fetch-site": "same-site",
        })
      ).status,
    ).toBe(403);
    expect(local.seen).toEqual([]);
  });

  it("holds a preview to its own address, other ports of this computer refused", async () => {
    const preview = await site("preview");
    const local = await site("dev server");
    const { gate: made, port } = await localGate(() => true);
    made.preview((at) => at === `127.0.0.1:${preview.port}`);
    await get(port, `http://127.0.0.1:${preview.port}/`);

    expect(
      (
        await get(port, `http://127.0.0.1:${local.port}/`, {
          "sec-fetch-site": "same-site",
        })
      ).status,
    ).toBe(403);
    expect(local.seen).toEqual([]);
    expect(made.takeRefused()).toEqual([`http://127.0.0.1:${local.port}`]);
  });
});

describe("the browser's proxy once the preview is asked for", () => {
  it("serves the preview, and refuses every other site, saying which", async () => {
    const preview = await site("preview");
    const shop = await site("shop");
    const { gate: made, port } = await gate({ "shop.test": shop.port });
    made.preview((at) => at === `127.0.0.1:${preview.port}`);

    const served = await get(
      port,
      `http://127.0.0.1:${preview.port}/index.html`,
    );
    const leak = await get(port, `http://shop.test:${shop.port}/?notes=secret`);
    const tunnelled = await tunnel(port, `shop.test:${shop.port}`);

    expect(served).toEqual({ status: 200, body: "preview" });
    expect(made.sealed()).toEqual([`127.0.0.1:${preview.port}`]);
    expect(leak.status).toBe(403);
    expect(tunnelled).toBe("HTTP/1.1 403 Forbidden");
    expect(shop.seen).toEqual([]);
    expect(made.takeRefused()).toEqual([
      `http://shop.test:${shop.port}`,
      `https://shop.test:${shop.port}`,
    ]);
    expect(made.takeRefused()).toEqual([]);
  });

  it("reaches the addresses allowed for the preview, and no other", async () => {
    const preview = await site("preview");
    const fonts = await site("fonts");
    const shop = await site("shop");
    const { gate: made, port } = await gate({
      "fonts.test": fonts.port,
      "shop.test": shop.port,
    });
    made.preview((at) => at === `127.0.0.1:${preview.port}`);
    await get(port, `http://127.0.0.1:${preview.port}/`);

    made.allow([`http://fonts.test:${fonts.port}`]);

    expect(await get(port, `http://fonts.test:${fonts.port}/a.woff2`)).toEqual({
      status: 200,
      body: "fonts",
    });
    expect((await get(port, `http://shop.test:${shop.port}/`)).status).toBe(
      403,
    );
    expect(await tunnel(port, `fonts.test:${fonts.port}`)).toBe(
      "HTTP/1.1 403 Forbidden",
    );
  });

  it("closes the tunnels opened before it, so none is used again from the preview", async () => {
    const preview = await site("preview");
    const shop = await site("shop");
    const { gate: made, port } = await gate({ "shop.test": shop.port });
    const pooled = connect(port, "127.0.0.1", () =>
      pooled.write(
        `CONNECT shop.test:${shop.port} HTTP/1.1\r\nHost: shop.test\r\n\r\n`,
      ),
    );
    await new Promise((open) => pooled.once("data", open));
    const closed = new Promise((done) => pooled.once("close", done));
    made.preview((at) => at === `127.0.0.1:${preview.port}`);

    await get(port, `http://127.0.0.1:${preview.port}/`);

    await closed;
    expect(pooled.destroyed).toBe(true);
  });

  it("is let out only when Zhiyin leaves the preview", async () => {
    const preview = await site("preview");
    const shop = await site("shop");
    const { gate: made, port } = await gate({ "shop.test": shop.port });
    made.preview((at) => at === `127.0.0.1:${preview.port}`);
    await get(port, `http://127.0.0.1:${preview.port}/`);

    made.leave();

    expect((await get(port, `http://shop.test:${shop.port}/`)).status).toBe(
      200,
    );
    expect(made.sealed()).toEqual([]);
  });

  it("is not sealed by a preview asked for but not yet requested", async () => {
    const shop = await site("shop");
    const { gate: made, port } = await gate({ "shop.test": shop.port });
    made.preview((at) => at === "127.0.0.1:1");

    expect((await get(port, `http://shop.test:${shop.port}/`)).status).toBe(
      200,
    );
    expect(made.sealed()).toEqual([]);
  });
});

describe("which addresses a page may reach", () => {
  it.each([
    "127.0.0.1",
    "127.8.9.10",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.20",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.251",
    "::1",
    "::",
    "fe80::1",
    "fd12:3456::1",
    "::ffff:192.168.1.20",
    "::ffff:127.0.0.1",
  ])("not %s, on this computer or the local network", (address) => {
    expect(reachable(address)).toBe(false);
  });

  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])(
    "%s, on the internet",
    (address) => {
      expect(reachable(address)).toBe(true);
    },
  );
});
