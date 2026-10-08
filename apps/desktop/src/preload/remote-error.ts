/**
 * Electron hands a command's error to the window as "Error invoking remote
 * method '<channel>': <name>: <message>". The window shows the core's own
 * words, so the wrapping is taken off here, where it is added.
 */
export function remoteError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const match = /^Error invoking remote method '[^']*': (?:\w*Error: )?/.exec(
    error.message,
  );
  return match ? new Error(error.message.slice(match[0].length)) : error;
}
