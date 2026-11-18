/**
 * The held preview against a real browser (ADR 0018). A server on this
 * computer stands in for a site on the internet: the browser's proxy is told
 * that `outside.test` is it, and that it may be reached. Every request it
 * receives from the preview's page is one that left. A UDP listener on this
 * computer's network address stands in for a STUN server, which WebRTC
 * reaches without any proxy unless the browser's profile forbids it.
 */
import { createSocket } from "node:dgram";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { openProcessContainer } from "@zhiyin/sandbox";
import { BrowserSession } from "../src/index.js";
import { browserAutomation } from "../src/automation-server.js";
import { playwrightBrowserLauncher } from "../src/playwright-launcher.js";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

/** Each request the stand-in site received, by its path. */
const reached: string[] = [];
const outside = createServer((request, response) => {
  reached.push(new URL(request.url ?? "/", "http://outside.test").pathname);
  if (request.headers.upgrade) {
    response.writeHead(400).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html",
    "Access-Control-Allow-Origin": "*",
  });
  response.end("<title>Outside</title>");
});
await new Promise<void>((done) => outside.listen(0, "127.0.0.1", done));
const site = `outside.test:${(outside.address() as AddressInfo).port}`;

/** Each STUN packet the stand-in received. */
let stunPackets = 0;
const stun = createSocket("udp4");
stun.on("message", () => (stunPackets += 1));
await new Promise<void>((done) => stun.bind(0, "0.0.0.0", done));
const lan = Object.values(networkInterfaces())
  .flat()
  .find((found) => found?.family === "IPv4" && !found.internal)?.address;

afterAll(() => {
  outside.closeAllConnections();
  outside.close();
  stun.close();
});

const launcher = playwrightBrowserLauncher(
  { open: openProcessContainer },
  {
    network: {
      lookup: async (host) => (host === "outside.test" ? "127.0.0.1" : host),
      reachable: (address) => address === "127.0.0.1",
    },
  },
);
const availability = await launcher.available();

/** A page that tries every way out it has, as soon as it loads. */
const leaky = `<!doctype html><title>Notes</title>
<link rel="stylesheet" href="http://${site}/style">
<img src="http://${site}/image">
<script>
fetch("http://${site}/fetch").catch(() => {});
fetch("https://${site}/secure").catch(() => {});
navigator.sendBeacon("http://${site}/beacon", "notes");
try { new WebSocket("ws://${site}/socket").onerror = () => {}; } catch {}
new Worker(URL.createObjectURL(new Blob(['fetch("http://${site}/worker").catch(() => {})'])));
const frame = document.createElement("iframe");
frame.src = "http://${site}/frame";
document.body.append(frame);
${
  lan
    ? `try {
  const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:${lan}:${stun.address().port}" }] });
  peer.createDataChannel("notes");
  peer.createOffer().then((offer) => peer.setLocalDescription(offer));
} catch {}`
    : ""
}
setTimeout(() => { location.href = "http://${site}/away"; }, 800);
</script>`;

/** A page whose service worker keeps trying to reach the site. */
const working = `<!doctype html><title>Worker</title>
<script>navigator.serviceWorker.register("worker.js").catch(() => {});</script>`;
const worker = `setInterval(() => fetch("http://${site}/tick").catch(() => {}), 100);
self.addEventListener("install", () => self.skipWaiting());`;

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));

const text = (result: unknown) =>
  (result as { content: { text?: string }[] }).content
    .map((part) => part.text ?? "")
    .join("\n");

async function previewing(files: Record<string, string>) {
  const root = await folders.make("zhiyin-preview-seal-");
  for (const [name, body] of Object.entries(files))
    await writeFile(join(root, name), body);
  const session = new BrowserSession({
    launcher,
    workspaceRoot: () => root,
    viewport: { width: 800, height: 600 },
  });
  const automation = browserAutomation(session);
  const opened = await automation.callTool("browser_preview", {
    path: "index.html",
  });
  return { session, automation, opened };
}

describe.runIf(availability.available)("the held preview", () => {
  it("sends nothing anywhere, by any way a page has, and says what it refused", async () => {
    reached.length = 0;
    stunPackets = 0;
    const { session, automation, opened } = await previewing({
      "index.html": leaky,
    });
    try {
      expect(text(opened)).toContain("reaches only its own files");
      await settle(2_000);

      expect(reached).toEqual([]);
      expect(stunPackets).toBe(0);
      // Its own move to the site was refused too.
      expect(session.state().title).not.toBe("Outside");
      // Each refused address is named once, with whichever answer came next.
      const answer =
        text(opened) + text(await automation.callTool("browser_snapshot", {}));
      expect(answer).toContain(`http://${site}`);
      expect(answer).toContain(`https://${site}`);
      // And only what the page asked for: the browser's own calls to its
      // maker's services are refused too, but are not the page's.
      const named = [
        ...answer.matchAll(/could not load from (.+?): it reaches/g),
      ].flatMap((found) => found[1]!.split(", "));
      expect(new Set(named)).toEqual(
        new Set([`http://${site}`, `https://${site}`]),
      );
    } finally {
      await automation.close();
      await session.close();
    }
  }, 60_000);

  it("reaches an address once it is allowed", async () => {
    reached.length = 0;
    const { session, automation } = await previewing({
      "index.html": `<title>Chart</title><script>fetch("http://${site}/library").catch(() => {});</script>`,
    });
    try {
      await settle(500);
      expect(reached).toEqual([]);

      await automation.callTool("browser_allow_addresses", {
        addresses: [`http://${site}`],
      });
      await automation.callTool("browser_navigate", {
        url: session.state().url,
      });
      await settle(500);

      expect(reached).toEqual(["/library"]);
    } finally {
      await automation.close();
      await session.close();
    }
  }, 60_000);

  it("is held again when the browser steps back to it", async () => {
    reached.length = 0;
    const { session, automation } = await previewing({
      "index.html": `<title>Ticking</title><script>setInterval(() => fetch("http://${site}/tick").catch(() => {}), 100);</script>`,
    });
    try {
      await automation.callTool("browser_navigate", {
        url: `http://${site}/after`,
      });
      // Back past the blank page leaving put between them.
      for (
        let step = 0;
        step < 3 && session.state().title !== "Ticking";
        step++
      )
        await session.back();
      await settle(1_000);

      expect(session.state().title).toBe("Ticking");
      expect(reached).not.toContain("/tick");
    } finally {
      await automation.close();
      await session.close();
    }
  }, 60_000);

  it("is left with nothing of it still running", async () => {
    reached.length = 0;
    const { session, automation } = await previewing({
      "index.html": working,
      "worker.js": worker,
    });
    try {
      await settle(1_000);
      expect(reached).toEqual([]);

      await automation.callTool("browser_navigate", {
        url: `http://${site}/after`,
      });
      await settle(1_500);

      expect(session.state().title).toBe("Outside");
      expect(reached).toContain("/after");
      expect(reached).not.toContain("/tick");
    } finally {
      await automation.close();
      await session.close();
    }
  }, 60_000);
});
