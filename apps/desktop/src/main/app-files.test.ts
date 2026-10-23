import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appFileOf, appPage } from "./app-files.js";

const root = join("C:", "Program Files", "Zhiyin", "renderer");

describe("the window's own files", () => {
  it("serves a file of the built window from its own address", () => {
    expect(appFileOf(root, appPage())).toBe(join(root, "index.html"));
    expect(appFileOf(root, "zhiyin://app/assets/index-1a2b.js")).toBe(
      join(root, "assets", "index-1a2b.js"),
    );
    expect(appFileOf(root, "zhiyin://app/assets/Noto%20Sans.woff2")).toBe(
      join(root, "assets", "Noto Sans.woff2"),
    );
  });

  it("serves nothing outside the built window, however the path is written", () => {
    for (const address of [
      "zhiyin://app/../main/index.js",
      "zhiyin://app/%2e%2e/main/index.js",
      "zhiyin://app/assets/..%2F..%2Fmain%2Findex.js",
      "zhiyin://app/assets/..%5C..%5Cmain%5Cindex.js",
      "zhiyin://app/C:/Windows/win.ini",
      "zhiyin://app/C%3A%5CWindows%5Cwin.ini",
      "zhiyin://app/%5C%5Cserver%5Cshare%5Cpicture.png",
      "zhiyin://app/assets/index.js%00.png",
    ]) {
      const file = appFileOf(root, address);
      expect(
        file === undefined || file.startsWith(join(root, "/")),
        `${address} gave ${file}`,
      ).toBe(true);
      expect(file ?? "", address).not.toMatch(/win\.ini|server|\.\.|\0/);
    }
  });

  it("serves nothing for an address that names no file", () => {
    expect(appFileOf(root, "zhiyin://app/")).toBeUndefined();
    expect(appFileOf(root, "zhiyin://app/%E0%A4%A")).toBeUndefined();
  });

  it("serves nothing for another host or another scheme", () => {
    for (const address of [
      "zhiyin://elsewhere/index.html",
      "file:///C:/Program%20Files/Zhiyin/renderer/index.html",
      "https://app/index.html",
      "not an address",
    ])
      expect(appFileOf(root, address), address).toBeUndefined();
  });

  it("names the page with what it was reopened for", () => {
    expect(appPage({ restarted: "1" })).toBe(
      "zhiyin://app/index.html?restarted=1",
    );
  });
});
