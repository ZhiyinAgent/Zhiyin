/**
 * Ports of a confined run's container shown on this computer. A container's
 * loopback is its own, so a server a run starts cannot be reached from
 * outside it. For each port asked for, Zhiyin listens on a port of this
 * computer's loopback, and a relay inside the container, started before the
 * program, keeps a connection to a pipe only that container may open. Each
 * connection to Zhiyin's port is paired with the relay's waiting one: the
 * relay is told to go, connects to the port on the container's loopback, and
 * carries bytes both ways until either side closes. Only that port is
 * reached, and only inward.
 */

import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { closeServer, listenFor } from "../pipe-openings.js";

export type ShownPort = {
  /** The port in the container. */
  readonly port: number;
  /** Where this computer reaches it, such as `http://127.0.0.1:52011`. */
  readonly address: string;
};

/** The relay's script, given on its command line, so it reads no file. */
function relayScript(pipe: string, port: number): string {
  return `$ErrorActionPreference = 'Stop'
$name = '${pipe}'
$port = ${port}
$open = [System.Collections.ArrayList]::new()
$waiting = $null
$read = $null
$go = [byte[]]::new(1)
while ($true) {
  if ($null -eq $waiting) {
    $waiting = [System.IO.Pipes.NamedPipeClientStream]::new('.', $name, [System.IO.Pipes.PipeDirection]::InOut, [System.IO.Pipes.PipeOptions]::Asynchronous)
    try { $waiting.Connect(10000) } catch { exit 0 }
    $read = $waiting.ReadAsync($go, 0, 1)
  }
  if ($read.Wait(50)) {
    $pipe = $waiting
    $waiting = $null
    if ($read.Result -eq 1) {
      $client = [System.Net.Sockets.TcpClient]::new()
      try {
        $client.Connect([System.Net.IPAddress]::Loopback, $port)
        $client.NoDelay = $true
        $stream = $client.GetStream()
        [void]$open.Add(@($client, $pipe, $stream.CopyToAsync($pipe), $pipe.CopyToAsync($stream)))
      } catch { $client.Dispose(); $pipe.Dispose() }
    } else { $pipe.Dispose() }
  }
  for ($at = $open.Count - 1; $at -ge 0; $at--) {
    $each = $open[$at]
    if ($each[2].IsCompleted -or $each[3].IsCompleted) {
      $each[0].Dispose()
      $each[1].Dispose()
      $open.RemoveAt($at)
    }
  }
}
`;
}

/** How to start the relay showing `port` through `pipe`. */
export function shownPortRelay(
  pipe: string,
  port: number,
): { readonly executable: string; readonly arguments: readonly string[] } {
  const name = /^\\\\\.\\pipe\\([\w-]+)$/.exec(pipe)?.[1];
  if (!name || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("A shown port needs a pipe of Zhiyin's and a real port.");
  return {
    executable: join(
      process.env["SystemRoot"] ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    arguments: [
      "-NoProfile",
      "-NonInteractive",
      "-NoLogo",
      "-EncodedCommand",
      Buffer.from(relayScript(name, port), "utf16le").toString("base64"),
    ],
  };
}

/**
 * One port's two ends: Zhiyin's listener on this computer's loopback and the
 * pipe the relay waits on. Each visitor waits for a relay connection, and each
 * relay connection for a visitor.
 */
export async function showPort(
  container: string,
  port: number,
): Promise<{
  readonly shown: ShownPort;
  readonly pipe: string;
  close(): Promise<void>;
}> {
  const relays: Socket[] = [];
  const visitors: Socket[] = [];
  const all = new Set<Socket>();
  const track = (socket: Socket) => {
    all.add(socket);
    socket.once("close", () => all.delete(socket));
    socket.on("error", () => socket.destroy());
  };
  const pair = () => {
    while (relays.length && visitors.length) {
      const relay = relays.shift()!;
      const visitor = visitors.shift()!;
      if (relay.destroyed || visitor.destroyed) {
        if (!relay.destroyed) relays.unshift(relay);
        if (!visitor.destroyed) visitors.unshift(visitor);
        continue;
      }
      relay.write(Buffer.from([1]));
      visitor.pipe(relay);
      relay.pipe(visitor);
      relay.once("close", () => visitor.destroy());
      visitor.once("close", () => relay.destroy());
    }
  };
  const waiting = (queue: Socket[]) => (socket: Socket) => {
    track(socket);
    queue.push(socket);
    socket.once("close", () => {
      const at = queue.indexOf(socket);
      if (at !== -1) queue.splice(at, 1);
    });
    pair();
  };
  const { path, server: pipeServer } = await listenFor(
    container,
    waiting(relays),
    "A shown port",
  );
  const listener: Server = createServer(waiting(visitors));
  try {
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", () => resolve());
    });
  } catch (error) {
    await closeServer(pipeServer);
    throw error;
  }
  const address = listener.address();
  const local = typeof address === "object" && address ? address.port : 0;
  return {
    shown: { port, address: `http://127.0.0.1:${local}` },
    pipe: path,
    close: async () => {
      for (const socket of all) socket.destroy();
      await Promise.all([closeServer(listener), closeServer(pipeServer)]);
    },
  };
}
