import { describe, expect, it } from "vitest";
import { fromOwnWindow } from "./ipc-policy.js";

/**
 * Who is allowed to send a command at all.
 *
 * Validating a payload says nothing about who sent it. Every privileged channel
 * is answered only for the window this app opened, and only for its own top
 * frame - an embedded or injected frame inside it is a different sender and is
 * refused, whatever the payload looks like.
 */
describe("who a command is accepted from", () => {
  const mainFrame = { name: "main" };
  const webContents = { mainFrame };
  const window = { webContents };

  it("accepts the app's own window, from its own top frame", () => {
    expect(
      fromOwnWindow({ sender: webContents, senderFrame: mainFrame }, window),
    ).toBe(true);
  });

  it("refuses another window's contents", () => {
    expect(
      fromOwnWindow(
        { sender: { mainFrame: {} }, senderFrame: mainFrame },
        window,
      ),
    ).toBe(false);
  });

  it("refuses a frame inside the right window that is not its top frame", () => {
    expect(
      fromOwnWindow(
        { sender: webContents, senderFrame: { name: "embedded" } },
        window,
      ),
    ).toBe(false);
  });

  it("refuses a sender that is missing altogether", () => {
    expect(
      fromOwnWindow({ sender: undefined, senderFrame: undefined }, window),
    ).toBe(false);
  });
});
