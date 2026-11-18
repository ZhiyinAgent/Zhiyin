/**
 * Whether a command came from the window this app owns, and from its own top
 * frame.
 *
 * A privileged channel that trusts whoever invoked it is a privileged channel
 * with no boundary. This is a plain comparison so it can be exercised without
 * an Electron window: the main process supplies the real objects, and the rule
 * lives here where it can be shown to hold.
 */
export function fromOwnWindow(
  event: { readonly sender: unknown; readonly senderFrame: unknown },
  window: { readonly webContents: { readonly mainFrame: unknown } },
): boolean {
  return (
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame
  );
}
