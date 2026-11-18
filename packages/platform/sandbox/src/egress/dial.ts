/**
 * How the proxy reaches a host a run may reach: directly, or through the
 * proxy this computer is set to use for it, as Chromium would choose. A
 * direct connection goes to the address the name resolved to here, and never
 * to this computer's loopback, an unassigned address or a link-local one,
 * whatever the name resolves to. An address this computer has on its network,
 * and any other private address, may be reached like any other.
 */

import { lookup } from "node:dns/promises";
import { BlockList, connect, isIP, type Socket } from "node:net";

/**
 * Says how this computer reaches a URL, in the form a PAC script answers:
 * `DIRECT`, or `PROXY host:port` or `SOCKS5 host:port`, several separated by
 * semicolons, tried in order.
 */
export type ProxyRoute = (url: string) => Promise<string>;

type Hop =
  | { readonly kind: "direct" }
  | {
      readonly kind: "http" | "socks5";
      readonly host: string;
      readonly port: number;
    };

/** Where no run reaches, by what each range is. */
const unreachable = (() => {
  const ranges = new BlockList();
  ranges.addSubnet("127.0.0.0", 8, "ipv4");
  ranges.addSubnet("0.0.0.0", 8, "ipv4");
  ranges.addSubnet("169.254.0.0", 16, "ipv4");
  ranges.addAddress("::1", "ipv6");
  ranges.addAddress("::", "ipv6");
  ranges.addSubnet("fe80::", 10, "ipv6");
  ranges.addSubnet("::ffff:127.0.0.0", 104, "ipv6");
  ranges.addSubnet("::ffff:0.0.0.0", 104, "ipv6");
  ranges.addSubnet("::ffff:169.254.0.0", 112, "ipv6");
  return ranges;
})();

/** Why no run reaches an address, or nothing when one may. */
export function unreachableAddress(address: string): string | undefined {
  const family = isIP(address);
  if (!family) return undefined;
  return unreachable.check(address, family === 6 ? "ipv6" : "ipv4")
    ? `${address} is this computer's loopback, no address, or a link-local one, which no run reaches.`
    : undefined;
}

/** The hops a PAC answer names, those the proxy can use, in order. */
export function hopsOf(answer: string): readonly Hop[] {
  const hops: Hop[] = [];
  for (const part of answer.split(";")) {
    const [kind = "", at = ""] = part.trim().split(/\s+/);
    if (kind.toUpperCase() === "DIRECT") {
      hops.push({ kind: "direct" });
      continue;
    }
    const proxy = /^(.+):(\d{1,5})$/.exec(at);
    if (!proxy) continue;
    const host = (proxy[1] as string).replace(/^\[(.*)\]$/, "$1");
    const port = Number(proxy[2]);
    if (kind.toUpperCase() === "PROXY") hops.push({ kind: "http", host, port });
    else if (kind.toUpperCase() === "SOCKS5")
      hops.push({ kind: "socks5", host, port });
  }
  return hops;
}

const connectTimeoutMs = 20_000;

/** A TCP connection, or the reason it could not be made. */
function tcp(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(connectTimeoutMs, () =>
      fail(new Error(`${host}:${port} did not answer in time`)),
    );
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.setTimeout(0);
      socket.off("error", fail);
      resolve(socket);
    });
  });
}

/** Reads from a socket until `enough` says what it holds is a whole reply. */
function readReply(
  socket: Socket,
  enough: (heard: Buffer) => number | undefined,
): Promise<{ readonly reply: Buffer; readonly rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let heard = Buffer.alloc(0);
    const done = (error?: Error) => {
      // Paused, so nothing the far end sends next is lost before the tunnel
      // is piped.
      socket.pause();
      socket.off("data", onData);
      socket.off("error", done);
      socket.off("end", ended);
      socket.setTimeout(0);
      if (error) reject(error);
    };
    const ended = () => done(new Error("the proxy closed the connection"));
    const onData = (chunk: Buffer) => {
      heard = Buffer.concat([heard, chunk]);
      const length = enough(heard);
      if (length !== undefined) {
        done();
        resolve({
          reply: heard.subarray(0, length),
          rest: heard.subarray(length),
        });
      } else if (heard.length > 16_384)
        done(new Error("the proxy's reply was too long"));
    };
    socket.on("data", onData);
    // A socket paused by the last reply does not flow again on its own.
    socket.resume();
    socket.once("error", done);
    socket.once("end", ended);
    socket.setTimeout(connectTimeoutMs, () =>
      done(new Error("the proxy did not answer in time")),
    );
  });
}

/** Asks an HTTP proxy to open a tunnel to `host`. */
async function throughHttp(
  proxy: Socket,
  host: string,
  port: number,
): Promise<void> {
  const target = isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
  proxy.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
  const { reply, rest } = await readReply(proxy, (heard) => {
    const end = heard.indexOf("\r\n\r\n");
    return end < 0 ? undefined : end + 4;
  });
  const status = /^HTTP\/1\.[01] (\d{3})/.exec(reply.toString("latin1"));
  if (status?.[1] !== "200")
    throw new Error(
      `the computer's proxy refused it (${status?.[1] ?? "no status"})`,
    );
  if (rest.length) proxy.unshift(rest);
}

/** Asks a SOCKS5 proxy, which needs no sign-in, to connect to `host`. */
async function throughSocks(
  proxy: Socket,
  host: string,
  port: number,
): Promise<void> {
  proxy.write(Buffer.from([5, 1, 0]));
  const greeting = await readReply(proxy, (heard) =>
    heard.length >= 2 ? 2 : undefined,
  );
  if (greeting.reply[1] !== 0)
    throw new Error("the computer's SOCKS proxy asks for a sign-in");
  const name = Buffer.from(host, "ascii");
  const portBytes = Buffer.from([port >> 8, port & 255]);
  proxy.write(
    Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, portBytes]),
  );
  const { reply, rest } = await readReply(proxy, (heard) => {
    if (heard.length < 5) return undefined;
    const kind = heard[3];
    const length =
      kind === 1
        ? 10
        : kind === 4
          ? 22
          : kind === 3
            ? 7 + (heard[4] as number)
            : 0;
    return length && heard.length >= length ? length : undefined;
  });
  if (reply[1] !== 0)
    throw new Error(`the computer's SOCKS proxy refused it (code ${reply[1]})`);
  if (rest.length) proxy.unshift(rest);
}

/** Connects to the first address `host` resolves to that a run may reach. */
async function direct(host: string, port: number): Promise<Socket> {
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true, verbatim: true })).map(
        (each) => each.address,
      );
  const reachable = addresses.filter((address) => !unreachableAddress(address));
  if (!reachable.length)
    throw new Error(
      unreachableAddress(addresses[0] ?? "") ?? `${host} has no address`,
    );
  let last: unknown;
  for (const address of reachable)
    try {
      return await tcp(address, port);
    } catch (error) {
      last = error;
    }
  throw last instanceof Error
    ? last
    : new Error(`${host} could not be reached`);
}

/**
 * A connection to `host` on `port`, by the first of the ways `route` names
 * that works; directly when no route is given.
 */
export async function dial(
  host: string,
  port: number,
  route: ProxyRoute | undefined,
): Promise<Socket> {
  const literal = unreachableAddress(host);
  if (literal) throw new Error(literal);
  const url = `https://${isIP(host) === 6 ? `[${host}]` : host}:${port}/`;
  const hops = route ? hopsOf(await route(url)) : [{ kind: "direct" } as const];
  if (!hops.length)
    throw new Error("the computer's proxy is of a kind Zhiyin cannot use");
  let last: unknown;
  for (const hop of hops) {
    try {
      if (hop.kind === "direct") return await direct(host, port);
      const proxy = await tcp(hop.host, hop.port);
      try {
        if (hop.kind === "http") await throughHttp(proxy, host, port);
        else await throughSocks(proxy, host, port);
        return proxy;
      } catch (error) {
        proxy.destroy();
        throw error;
      }
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error
    ? last
    : new Error(`${host} could not be reached`);
}
