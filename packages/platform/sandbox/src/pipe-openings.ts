/**
 * Pipes a confined run's container may open to reach Zhiyin: each listens on
 * a name no one can guess, which only Zhiyin, Windows and that one container
 * may open, and is named to the program in a variable. What a connection
 * carries is the caller's to decide.
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { openPipeTo } from "./egress/pipe-access.js";

export type PipeOpening = {
  /** The variable the program finds the pipe's name in, such as `ZHIYIN_GIT`. */
  readonly variable: string;
  /** Handed each connection the program makes, as it is made. */
  readonly accept: (connection: Socket) => void;
};

export type OpenPipes = {
  /** The variables naming each pipe, for the program's environment. */
  readonly environment: Readonly<Record<string, string>>;
  close(): Promise<void>;
};

const variables = /^[A-Z][A-Z0-9_]{0,63}$/;

/** A server listening on a new pipe open to `container` alone, and its path. */
export async function listenFor(
  container: string,
  accept: (connection: Socket) => void,
  what: string,
): Promise<{ readonly path: string; readonly server: Server }> {
  const path = `\\\\.\\pipe\\zhiyin-${process.pid}-${randomUUID()}`;
  const server = createServer(accept);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
  try {
    openPipeTo(path, container, what);
  } catch (error) {
    await closeServer(server);
    throw error;
  }
  return { path, server };
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Opens each pipe to `container` (a SID's text). Throws, saying why, when a
 * variable cannot name one or a pipe cannot be opened; nothing is left
 * listening then.
 */
export async function openPipes(
  container: string,
  openings: readonly PipeOpening[],
): Promise<OpenPipes> {
  const servers: Server[] = [];
  const connections = new Set<Socket>();
  const environment: Record<string, string> = {};
  const close = async () => {
    for (const connection of connections) connection.destroy();
    await Promise.all(servers.map(closeServer));
  };
  try {
    for (const opening of openings) {
      if (!variables.test(opening.variable))
        throw new Error(
          `“${opening.variable}” cannot name a pipe: use capital letters, digits and underscores.`,
        );
      const { path, server } = await listenFor(
        container,
        (connection) => {
          connections.add(connection);
          connection.once("close", () => connections.delete(connection));
          opening.accept(connection);
        },
        "Zhiyin's pipe",
      );
      servers.push(server);
      environment[opening.variable] = path;
    }
  } catch (error) {
    await close();
    throw error;
  }
  return { environment, close };
}
