/**
 * The relay inside a run's container. A container cannot reach Zhiyin's
 * loopback, and the programs it runs speak to a proxy only over TCP, so the
 * relay listens on the container's own loopback and carries each connection
 * to the proxy's pipe. It is Windows PowerShell, which every container may
 * run, given its script on the command line, so no file of its own is read
 * or written. It holds no authority, since the proxy decides every host.
 */

import { join } from "node:path";

/**
 * Listens on loopback, tells the proxy its port on a first connection, then
 * carries each connection to a connection of its own to the pipe until either
 * side closes.
 */
function relayScript(pipe: string): string {
  return `$ErrorActionPreference = 'Stop'
$name = '${pipe}'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$hello = [System.IO.Pipes.NamedPipeClientStream]::new('.', $name, [System.IO.Pipes.PipeDirection]::InOut)
$hello.Connect(10000)
$said = [System.Text.Encoding]::ASCII.GetBytes("ZHIYIN-RELAY $($listener.LocalEndpoint.Port)\`r\`n\`r\`n")
$hello.Write($said, 0, $said.Length)
$hello.Flush()
$hello.Dispose()
$open = [System.Collections.ArrayList]::new()
$accept = $listener.AcceptTcpClientAsync()
while ($true) {
  if ($accept.Wait(50)) {
    $client = $accept.Result
    $accept = $listener.AcceptTcpClientAsync()
    $client.NoDelay = $true
    $pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $name, [System.IO.Pipes.PipeDirection]::InOut, [System.IO.Pipes.PipeOptions]::Asynchronous)
    try { $pipe.Connect(10000) } catch { $client.Dispose(); $pipe.Dispose(); continue }
    $stream = $client.GetStream()
    [void]$open.Add(@($client, $pipe, $stream.CopyToAsync($pipe), $pipe.CopyToAsync($stream)))
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

/** How to start the relay for the proxy on `pipe`. */
export function relayStart(pipe: string): {
  readonly executable: string;
  readonly arguments: readonly string[];
} {
  if (!/^[\w-]+$/.test(pipe))
    throw new Error("A pipe name is letters, digits and dashes.");
  return {
    executable: join(
      process.env["SystemRoot"] ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    // As an encoded command, which no execution policy refuses.
    arguments: [
      "-NoProfile",
      "-NonInteractive",
      "-NoLogo",
      "-EncodedCommand",
      Buffer.from(relayScript(pipe), "utf16le").toString("base64"),
    ],
  };
}
