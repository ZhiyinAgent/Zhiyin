/**
 * The proxy a confined run reaches the network through. It listens on a pipe
 * only the run's container may open, takes HTTPS tunnels (`CONNECT`) to the
 * hosts the run may reach and refuses every other request, and counts what
 * went to and came from each of the first hundred hosts asked for, and from
 * the rest together. The relay inside the container tells it,
 * on its first connection, the loopback port the run's programs are given.
 */

import { randomUUID } from "node:crypto";
import { createServer, isIP, type Server, type Socket } from "node:net";
import { dial, type ProxyRoute } from "./dial.js";
import { allows, plainHost, type HostEntry } from "./hosts.js";
import { openPipeTo } from "./pipe-access.js";

/** What a run did with one host. */
export type HostReach = {
  /** The host as the program asked for it. */
  readonly host: string;
  readonly port: number;
  /** Tunnels opened to it; none when every request was refused. */
  readonly connections: number;
  /** Bytes the program sent to it, and received from it. */
  readonly sent: number;
  readonly received: number;
  /** Why Zhiyin refused requests to it, when it did. */
  readonly refused?: string;
  /** Why it could not be reached, when a tunnel to it failed. */
  readonly failed?: string;
};

/**
 * What a run did with the hosts past the first hundred it asked for, which
 * are counted, not named: each request refused or that could not be reached,
 * and the tunnels opened with the bytes they carried.
 */
export type FurtherHosts = {
  readonly refused: number;
  readonly failed: number;
  readonly connections: number;
  readonly sent: number;
  readonly received: number;
};

const relayGreeting = /^ZHIYIN-RELAY (\d{1,5})$/;
const mostHeaderBytes = 8192;
const headerTimeoutMs = 15_000;
const mostTunnels = 64;
const mostNamedHosts = 100;

type Tally = {
  host: string;
  port: number;
  connections: number;
  sent: number;
  received: number;
  refused?: string;
  failed?: string;
};

type Counts = { -readonly [K in keyof FurtherHosts]: FurtherHosts[K] };

export class HostProxy {
  readonly pipe: string;
  readonly #server: Server;
  readonly #entries: readonly HostEntry[];
  readonly #route: ProxyRoute | undefined;
  readonly #sockets = new Set<Socket>();
  readonly #tallies = new Map<string, Tally>();
  readonly #further: Counts = {
    refused: 0,
    failed: 0,
    connections: 0,
    sent: 0,
    received: 0,
  };
  #relay: ((port: number) => void) | undefined;
  #relayPort: Promise<number>;
  #tunnels = 0;

  private constructor(
    pipe: string,
    entries: readonly HostEntry[],
    route: ProxyRoute | undefined,
  ) {
    this.pipe = pipe;
    this.#entries = entries;
    this.#route = route;
    this.#relayPort = new Promise((resolve) => (this.#relay = resolve));
    this.#server = createServer((socket) => this.#accept(socket));
  }

  /** A proxy listening, open to `container` (a SID's text) alone. */
  static async open(options: {
    readonly container: string;
    readonly hosts: readonly HostEntry[];
    readonly route?: ProxyRoute;
  }): Promise<HostProxy> {
    const proxy = new HostProxy(
      `zhiyin-network-${process.pid}-${randomUUID()}`,
      options.hosts,
      options.route,
    );
    const path = `\\\\.\\pipe\\${proxy.pipe}`;
    await new Promise<void>((resolve, reject) => {
      proxy.#server.once("error", reject);
      proxy.#server.listen(path, () => {
        proxy.#server.off("error", reject);
        resolve();
      });
    });
    try {
      openPipeTo(path, options.container);
    } catch (error) {
      await proxy.close();
      throw error;
    }
    return proxy;
  }

  /** The loopback port the relay listens on, once it has said it. */
  relayPort(): Promise<number> {
    return this.#relayPort;
  }

  /**
   * The first hundred hosts the run asked for, reached or refused, in the
   * order first asked. A host is a name and a port.
   */
  reached(): readonly HostReach[] {
    return [...this.#tallies.values()].map((tally) => ({ ...tally }));
  }

  /** What went to the hosts past the first hundred, when the run asked for any. */
  further(): FurtherHosts | undefined {
    const counts = this.#further;
    return counts.refused || counts.failed || counts.connections
      ? { ...counts }
      : undefined;
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  /** The tally of a named host, or undefined once a hundred are named. */
  #tally(host: string, port: number): Tally | undefined {
    const key = `${host}:${port}`;
    let tally = this.#tallies.get(key);
    if (!tally && this.#tallies.size < mostNamedHosts) {
      tally = { host, port, connections: 0, sent: 0, received: 0 };
      this.#tallies.set(key, tally);
    }
    return tally;
  }

  #track(socket: Socket): void {
    this.#sockets.add(socket);
    socket.once("close", () => this.#sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  }

  #accept(socket: Socket): void {
    this.#track(socket);
    let heard = Buffer.alloc(0);
    const timer = setTimeout(() => socket.destroy(), headerTimeoutMs);
    const onData = (chunk: Buffer) => {
      heard = Buffer.concat([heard, chunk]);
      const end = heard.indexOf("\r\n\r\n");
      if (end < 0) {
        if (heard.length > mostHeaderBytes) socket.destroy();
        return;
      }
      clearTimeout(timer);
      socket.off("data", onData);
      socket.pause();
      const rest = heard.subarray(end + 4);
      if (rest.length) socket.unshift(rest);
      void this.#request(socket, heard.subarray(0, end).toString("latin1"));
    };
    socket.on("data", onData);
    socket.once("close", () => clearTimeout(timer));
  }

  async #request(socket: Socket, header: string): Promise<void> {
    const line = header.split("\r\n")[0] ?? "";
    const greeting = relayGreeting.exec(line);
    if (greeting) {
      // Only the relay's first word counts: it speaks before any program runs.
      this.#relay?.(Number(greeting[1]));
      this.#relay = undefined;
      socket.end();
      return;
    }
    const [method = "", target = ""] = line.split(" ");
    if (method.toUpperCase() !== "CONNECT") {
      const named = /^[a-z]+:\/\/([^/:]+)(?::(\d+))?/i.exec(target);
      if (named)
        this.#refuse(
          socket,
          named[1] as string,
          Number(named[2] ?? 80),
          { refused: "only HTTPS is allowed" },
          405,
        );
      else socket.end("HTTP/1.1 405 Only HTTPS tunnels\r\n\r\n");
      return;
    }
    const parts = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(target);
    const host = parts ? plainHost(parts[1] as string) : undefined;
    const port = Number(parts?.[2]);
    if (!host || !(port >= 1 && port <= 65535)) {
      socket.end("HTTP/1.1 400 Name a host and port\r\n\r\n");
      return;
    }
    if (!allows(this.#entries, host, port)) {
      this.#refuse(
        socket,
        host,
        port,
        { refused: "not among the hosts this run may reach" },
        403,
      );
      return;
    }
    if (this.#tunnels >= mostTunnels) {
      socket.end("HTTP/1.1 503 Too many connections at once\r\n\r\n");
      return;
    }
    this.#tunnels += 1;
    let outside: Socket;
    try {
      outside = await dial(host, port, this.#route);
    } catch (error) {
      this.#tunnels -= 1;
      const reason = error instanceof Error ? error.message : String(error);
      this.#refuse(socket, host, port, { failed: reason }, 502);
      return;
    }
    this.#track(outside);
    const tally = this.#tally(host, port) ?? this.#further;
    tally.connections += 1;
    if (socket.destroyed) {
      outside.destroy();
      this.#tunnels -= 1;
      return;
    }
    socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    socket.on("data", (chunk: Buffer) => (tally.sent += chunk.length));
    outside.on("data", (chunk: Buffer) => (tally.received += chunk.length));
    let open = true;
    const end = () => {
      if (!open) return;
      open = false;
      this.#tunnels -= 1;
      socket.destroy();
      outside.destroy();
    };
    socket.once("close", end);
    outside.once("close", end);
    socket.pipe(outside);
    outside.pipe(socket);
  }

  #refuse(
    socket: Socket,
    host: string,
    port: number,
    why: { readonly refused?: string; readonly failed?: string },
    status: number,
  ): void {
    const shown = isIP(host) === 6 ? `[${host}]` : host;
    const tally = this.#tally(host, port);
    if (!tally) {
      if (why.refused) this.#further.refused += 1;
      if (why.failed) this.#further.failed += 1;
    }
    if (why.refused && tally) tally.refused ??= why.refused;
    if (why.failed && tally) tally.failed ??= why.failed;
    const reason = why.refused ?? why.failed;
    socket.end(
      `HTTP/1.1 ${status} ${shown}:${port} refused\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${why.refused ? "Zhiyin refused" : "Zhiyin could not reach"} ${shown}:${port}: ${reason}.\n`,
    );
  }
}
