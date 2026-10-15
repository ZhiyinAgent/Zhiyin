/**
 * What the window itself may do, asked of the running app. The window draws
 * what models write, so it is given nothing a page could ask a browser for,
 * and its page cannot be pointed somewhere else.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeEverything, launch } from "./launch.js";

afterEach(closeEverything);

describe("the running app's window", () => {
  it("is refused every permission a page can ask for", async () => {
    const { window } = await launch();

    const answers = await window.evaluate(async () => ({
      notifications: await Notification.requestPermission(),
      microphone: await navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then(
          () => "granted",
          () => "denied",
        ),
    }));

    expect(answers).toEqual({ notifications: "denied", microphone: "denied" });
  });

  it("keeps its own address when a page part names another base for its links", async () => {
    const { window } = await launch();

    const base = await window.evaluate(() => {
      const before = document.baseURI;
      const planted = document.createElement("base");
      planted.href = "https://example.com/";
      document.head.append(planted);
      const after = document.baseURI;
      planted.remove();
      return { before, after };
    });

    expect(base.after).toBe(base.before);
  });
});
