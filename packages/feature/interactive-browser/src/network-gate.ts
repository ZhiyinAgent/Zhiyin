/**
 * The proxy every connection of Zhiyin's browser goes through (ADR 0018). It
 * looks each address up itself, connects only to the address it checked, and
 * reaches nothing on this computer or the local network but the preview.
 * From the moment the preview's own address is asked for, it reaches only
 * that address and the origins allowed for the preview, until Zhiyin leaves
 * the preview; what it refused meanwhile is kept to tell the model.
 */

import { lookup as lookUp } from "node:dns/promises";
import {
  createServer,
  request as forward,
  type IncomingMessage,
  type Server,
} from "node:http";
import {
  BlockList,
  connect,
  isIP,
  type LookupFunction,
  type Socket,
} from "node:net";

/** Addresses on this computer, the local network, or no one's. */
const local = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  local.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 127],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  local.addSubnet(network, prefix, "ipv6");

/** Whether a page may reach this address: one on the internet, never this computer or its network. */
export function reachable(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return reachable(mapped);
  const family = isIP(address);
  if (!family) return false;
  return !local.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** A host as an origin compares it: lower case, without brackets. */
const hostOf = (host: string) => host.replace(/^\[|\]$/g, "").toLowerCase();

/** `scheme://host:port`, the port always said. */
function originOf(
  scheme: "http" | "https",
  host: string,
  port: number,
): string {
  const bare = hostOf(host);
  return `${scheme}://${bare.includes(":") ? `[${bare}]` : bare}:${port}`;
}

/**
 * An origin as it may be allowed for the preview, `scheme://host:port` with
 * its port said, or nothing when what was given is not an origin.
 */
export function allowedOrigin(given: string): string | undefined {
  try {
    const url = new URL(given);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (url.pathname !== "/" || url.search || url.hash || url.username) return;
    const scheme = url.protocol === "https:" ? "https" : "http";
    const port = Number(url.port) || (scheme === "https" ? 443 : 80);
    return originOf(scheme, url.hostname, port);
  } catch {
    return undefined;
  }
}

export type NetworkGateOptions = {
  /** Looks a host up; this machine's resolver, every address, by default. */
  readonly lookup?: (host: string) => Promise<string | readonly string[]>;
  /** Which looked-up addresses may be reached; those on the internet by default. */
  readonly reachable?: (address: string) => boolean;
};

/** A host written as one of this computer's: `localhost`, a name under it, or an address. */
const writtenLocal = (host: string) =>
  host === "localhost" || host.endsWith(".localhost") || isIP(host) !== 0;

/**
 * What the browser says, in `Sec-Fetch-Site`, a request came from: the
 * person or Zhiyin, or a page of the site it goes to. No page can set it.
 */
const ownSite = new Set(["none", "same-origin", "same-site"]);

/**
 * Whether the page a request came from, by its `Origin` or `Referer`, is on
 * this computer or its network, written as such. No page can set either.
 */
function fromLocal(from: string | undefined): boolean {
  if (!from) return false;
  try {
    const host = hostOf(new URL(from).hostname);
    return writtenLocal(host) && (isIP(host) === 0 || !reachable(host));
  } catch {
    return false;
  }
}

/**
 * Connection options that reach only the addresses checked, each tried in
 * turn, as the browser tries a name's addresses.
 */
function only(host: string, addresses: readonly string[]) {
  const all = addresses.map((address) => ({
    address,
    family: isIP(address),
  }));
  return {
    host,
    autoSelectFamily: true,
    lookup: ((_host, options, done) =>
      options.all
        ? done(null, all)
        : done(null, all[0]!.address, all[0]!.family)) as LookupFunction,
  };
}

export class NetworkGate {
  readonly #lookup: (host: string) => Promise<string | readonly string[]>;
  readonly #reachable: (address: string) => boolean;
  readonly #sockets = new Set<Socket>();
  #server: Server | undefined;
  /** Whether a `host:port` is the preview's, now. */
  #isPreview: (hostPort: string) => boolean = () => false;
  /** Whether Zhiyin's page is at, or being sent to, a `host:port`. */
  #pageAt: (hostPort: string) => boolean = () => false;
  /** Each preview's `host:port` the browser is held to; none while it is free. */
  readonly #sealed = new Set<string>();
  readonly #allowed = new Set<string>();
  #refused: string[] = [];

  constructor(options: NetworkGateOptions = {}) {
    this.#lookup =
      options.lookup ??
      (async (host) =>
        (await lookUp(host, { all: true })).map((found) => found.address));
    this.#reachable = options.reachable ?? reachable;
  }

  /** Starts listening on loopback; answers the port. */
  async start(): Promise<number> {
    const server = createServer((req, res) => {
      req.on("error", () => res.destroy());
      res.on("error", () => res.destroy());
      void this.#pass(req).then((target) => {
        if (!target) {
          res.writeHead(403).end();
          return;
        }
        const out = forward(
          {
            ...only(target.host, target.addresses),
            port: target.port,
            method: req.method,
            path: target.path,
            headers: req.headers,
            setHost: false,
            // A connection of its own: none is kept to be used again.
            agent: false,
          },
          (answer) => {
            answer.on("error", () => res.destroy());
            res.writeHead(answer.statusCode ?? 502, answer.headers);
            answer.pipe(res);
          },
        );
        out.on("error", () =>
          res.headersSent ? res.destroy() : res.writeHead(502).end(),
        );
        // A browser that stops reading, as when it stops a download, stops
        // the site sending.
        res.on("close", () => out.destroy());
        req.pipe(out);
      });
    });
    // HTTPS and secure WebSockets, as a tunnel to the host and port asked.
    server.on(
      "connect",
      (req: IncomingMessage, client: Socket, head: Buffer) => {
        this.#track(client);
        const [host, port] = splitHost(req.url ?? "", 443);
        void this.#reach("https", host, port).then((addresses) => {
          if (!addresses) {
            client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
            return;
          }
          const upstream = this.#track(
            connect({ ...only(hostOf(host), addresses), port }),
          );
          upstream.once("connect", () => {
            client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (head.length) upstream.write(head);
            upstream.pipe(client);
            client.pipe(upstream);
          });
          upstream.on("close", () => client.destroy());
          client.on("close", () => upstream.destroy());
          upstream.on("error", () => client.destroy());
          client.on("error", () => upstream.destroy());
        });
      },
    );
    // A plain WebSocket: its upgrade request passed on whole.
    server.on(
      "upgrade",
      (req: IncomingMessage, client: Socket, head: Buffer) => {
        this.#track(client);
        void this.#pass(req).then((target) => {
          if (!target) {
            client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
            return;
          }
          const upstream = this.#track(
            connect({
              ...only(target.host, target.addresses),
              port: target.port,
            }),
          );
          upstream.once("connect", () => {
            const lines = [
              `${req.method} ${target.path} HTTP/${req.httpVersion}`,
            ];
            for (let at = 0; at < req.rawHeaders.length; at += 2)
              lines.push(`${req.rawHeaders[at]}: ${req.rawHeaders[at + 1]}`);
            upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
            if (head.length) upstream.write(head);
            upstream.pipe(client);
            client.pipe(upstream);
          });
          upstream.on("close", () => client.destroy());
          client.on("close", () => upstream.destroy());
          upstream.on("error", () => client.destroy());
          client.on("error", () => upstream.destroy());
        });
      },
    );
    server.on("clientError", (_error, socket) => socket.destroy());
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    this.#server = server;
    return (server.address() as { port: number }).port;
  }

  /**
   * Says which `host:port` is the preview's: the first request for one
   * holds the browser to it and what is allowed for it.
   */
  preview(isPreview: (hostPort: string) => boolean): void {
    this.#isPreview = isPreview;
  }

  /**
   * Says which `host:port` Zhiyin's page is at or being sent to: one on this
   * computer or its network is reached for that page, never for another.
   */
  page(isAt: (hostPort: string) => boolean): void {
    this.#pageAt = isAt;
  }

  /** Lets the browser out of the preview, as Zhiyin leaves it. */
  leave(): void {
    this.#sealed.clear();
  }

  /** Each preview's `host:port` the browser is held to; none while it is free. */
  sealed(): readonly string[] {
    return [...this.#sealed];
  }

  /**
   * Allows the preview these origins, each `scheme://host[:port]`; answers
   * those that are not one.
   */
  allow(origins: readonly string[]): readonly string[] {
    const wrong: string[] = [];
    for (const given of origins) {
      const origin = allowedOrigin(given);
      if (origin) this.#allowed.add(origin);
      else wrong.push(given);
    }
    return wrong;
  }

  /** What the sealed preview was refused since this was last asked, each once. */
  takeRefused(): readonly string[] {
    const refused = [...new Set(this.#refused)];
    this.#refused = [];
    return refused;
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    const server = this.#server;
    this.#server = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }

  #track(socket: Socket): Socket {
    // A connection reset before it is joined to another ends there.
    socket.on("error", () => socket.destroy());
    this.#sockets.add(socket);
    socket.once("close", () => this.#sockets.delete(socket));
    return socket;
  }

  /** Where a plain request goes, when it may: the host, the addresses checked, its port and path. */
  async #pass(req: IncomingMessage): Promise<
    | {
        host: string;
        addresses: readonly string[];
        port: number;
        path: string;
      }
    | undefined
  > {
    let url: URL;
    try {
      url = new URL(req.url ?? "");
    } catch {
      return undefined;
    }
    if (url.protocol !== "http:" && url.protocol !== "ws:") return undefined;
    const port = Number(url.port) || 80;
    const addresses = await this.#reach("http", url.hostname, port, {
      site: req.headers["sec-fetch-site"],
      from: req.headers.origin ?? req.headers.referer,
    });
    return addresses
      ? {
          host: hostOf(url.hostname),
          addresses,
          port,
          path: `${url.pathname}${url.search}`,
        }
      : undefined;
  }

  /**
   * The addresses to connect to for `host:port`, or nothing when it may not
   * be reached. `asker` is what the browser said the request came from, when
   * it said.
   */
  async #reach(
    scheme: "http" | "https",
    host: string,
    port: number,
    asker: { site?: string | undefined; from?: string | undefined } = {},
  ): Promise<readonly string[] | undefined> {
    const bare = hostOf(host);
    const at = `${bare.includes(":") ? `[${bare}]` : bare}:${port}`;
    if (scheme === "http" && this.#isPreview(at)) {
      // The preview's own address, on loopback: asking for it seals the
      // browser before it is answered, and closes every tunnel opened
      // before, which the browser would otherwise use again unchecked.
      if (!this.#sealed.size)
        for (const socket of this.#sockets) socket.destroy();
      this.#sealed.add(at);
      return [bare];
    }
    const origin = originOf(scheme, bare, port);
    if (this.#sealed.size && !this.#allowed.has(origin)) {
      this.#refused.push(origin);
      return undefined;
    }
    const addresses = await this.#addresses(bare);
    if (!addresses) return undefined;
    if (addresses.every((address) => this.#reachable(address)))
      return addresses;
    // This computer or its network, written as such, is reached as the
    // browser alone would reach it: when the person or Zhiyin sent the page
    // there, or for what a page on this computer or its network asks. Never
    // for a website's page, never while the preview is held, and never by a
    // name that looks up to it, which could be a website's.
    if (this.#sealed.size || !writtenLocal(bare)) return undefined;
    return ownSite.has(asker.site ?? "") ||
      fromLocal(asker.from) ||
      this.#pageAt(at)
      ? addresses
      : undefined;
  }

  async #addresses(host: string): Promise<readonly string[] | undefined> {
    const found = await this.#lookup(host).catch(() => undefined);
    const addresses = typeof found === "string" ? [found] : found;
    return addresses?.length ? addresses : undefined;
  }
}

/** `host:port` split, the port `fallback` when none is said. */
function splitHost(given: string, fallback: number): [string, number] {
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(given);
  if (!match) return [given, fallback];
  return [match[1]!, Number(match[2] ?? fallback)];
}
