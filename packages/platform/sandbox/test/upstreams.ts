/**
 * Stand-ins for the network beyond the proxy: an HTTP proxy and a SOCKS5
 * proxy that this computer might be set to use, each of which records what
 * it was asked to reach and then answers as the host would, and a plain
 * server that echoes what it hears.
 */

import { createServer, type Server, type Socket } from "node:net";

export type Upstream = {
  readonly port: number;
  /** Each host:port it was asked to reach, in order. */
  readonly asked: string[];
  close(): Promise<void>;
};

/** What a host behind the stand-in answers each piece of data with. */
function answerAs(target: string, socket: Socket): void {
  socket.on("data", (chunk: Buffer) =>
    socket.write(`${target} heard ${chunk}`),
  );
}

async function listening(
  server: Server,
  sockets: Set<Socket>,
): Promise<number> {
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

function closer(server: Server, sockets: Set<Socket>) {
  return () =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
}

/** An HTTP proxy that opens every tunnel asked of it. */
export async function httpUpstream(): Promise<Upstream> {
  const asked: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    let heard = "";
    const onData = (chunk: Buffer) => {
      heard += chunk.toString("latin1");
      const end = heard.indexOf("\r\n\r\n");
      if (end < 0) return;
      socket.off("data", onData);
      const target = heard.split(" ")[1] ?? "";
      asked.push(target);
      socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      answerAs(target, socket);
    };
    socket.on("data", onData);
  });
  const port = await listening(server, sockets);
  return { port, asked, close: closer(server, sockets) };
}

/** A SOCKS5 proxy that needs no sign-in and connects every name asked of it. */
export async function socksUpstream(): Promise<Upstream> {
  const asked: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    let stage: "greeting" | "request" = "greeting";
    const onData = (chunk: Buffer) => {
      if (stage === "greeting") {
        stage = "request";
        socket.write(Buffer.from([5, 0]));
        return;
      }
      socket.off("data", onData);
      const length = chunk[4] as number;
      const name = chunk.subarray(5, 5 + length).toString("ascii");
      const port = chunk.readUInt16BE(5 + length);
      const target = `${name}:${port}`;
      asked.push(target);
      socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
      answerAs(target, socket);
    };
    socket.on("data", onData);
  });
  const port = await listening(server, sockets);
  return { port, asked, close: closer(server, sockets) };
}

/** A server on every address of this computer that echoes what it hears. */
export async function echoServer(): Promise<Upstream> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => answerAs("echo", socket));
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { port: address.port, asked: [], close: closer(server, sockets) };
}
