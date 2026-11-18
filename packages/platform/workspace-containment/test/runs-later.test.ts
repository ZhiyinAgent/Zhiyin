import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runsLater, startupFolders } from "../src/index.js";

const startMenu = join("Microsoft", "Windows", "Start Menu", "Programs");

describe("a file that runs later without anyone starting it", () => {
  it("is one in a .git folder at any depth, whatever its case or trailing dots and spaces", () => {
    for (const path of [
      "C:\\work\\.git\\hooks\\pre-commit",
      "C:\\work\\vendor\\lib\\.git\\config",
      "C:\\work\\.GIT\\config",
      "C:\\work\\.git.\\config",
      "C:\\work\\.git \\config",
      "C:/work/.git/config",
    ])
      expect(runsLater(path, [])).toBe(true);
  });

  it("is one in the person's Startup folder or the one for every account", () => {
    for (const folder of startupFolders())
      expect(runsLater(join(folder, "run.cmd"))).toBe(true);
  });

  it("is one in another account's Startup folder, or any Startup folder under a Start Menu, whatever its case", () => {
    expect(
      runsLater(
        join(
          "C:\\Users\\someone\\AppData\\Roaming",
          startMenu,
          "Startup",
          "a.cmd",
        ),
        [],
      ),
    ).toBe(true);
    expect(
      runsLater("D:\\backup\\START MENU\\programs\\StartUp\\a.lnk", []),
    ).toBe(true);
  });

  it("is one in a Startup folder it is told of, whatever its case", () => {
    expect(runsLater("C:\\Odd\\Place\\A.cmd", ["c:\\odd\\place"])).toBe(true);
    expect(runsLater("c:\\odd\\place", ["C:\\Odd\\Place"])).toBe(true);
  });

  it("is not a file whose name only resembles one of those places", () => {
    for (const path of [
      "C:\\work\\.github\\workflows\\ci.yml",
      "C:\\work\\my.git\\notes.md",
      "C:\\work\\.gitignore",
      join("C:\\Users\\me\\AppData\\Roaming", startMenu, "Games", "a.lnk"),
      "C:\\work\\Startup\\plan.md",
      "C:\\Odd\\Placement\\a.cmd",
    ])
      expect(runsLater(path, ["C:\\Odd\\Place"])).toBe(false);
  });
});
