import { describe, expect, it } from "vitest";
import { below, folderKey, inside, sameFolder } from "../src/index.js";

describe("two spellings of one folder", () => {
  it.each([
    ["C:\\Work\\Report", "c:\\work\\report"],
    ["C:\\Work\\Report\\", "C:\\Work\\Report"],
    ["C:/Work//Report/", "C:\\Work\\Report"],
    ["C:\\Work\\.\\Drafts\\..\\Report", "C:\\Work\\Report"],
    ["\\\\server\\share\\Team", "//SERVER/share/team/"],
    ["C:\\", "c:/"],
  ])("%s names the same folder as %s", (one, other) => {
    expect(sameFolder(one, other)).toBe(true);
  });

  it.each([
    ["C:\\Work\\Report", "C:\\Work\\Reports"],
    ["C:\\Work", "D:\\Work"],
    ["C:\\Work\\..Report", "C:\\Report"],
    ["\\\\server\\share", "\\\\server\\other"],
  ])("%s is not %s", (one, other) => {
    expect(sameFolder(one, other)).toBe(false);
  });

  it("keeps a drive's root and a share's root as roots, and never climbs above them", () => {
    expect(folderKey("C:\\")).toBe("c:\\");
    expect(folderKey("C:\\..\\..\\Windows")).toBe("c:\\windows");
    expect(folderKey("\\\\Server\\Share\\")).toBe("\\\\server\\share\\");
    expect(folderKey("\\\\server\\share\\..\\other")).toBe(
      "\\\\server\\share\\other",
    );
  });
});

describe("a path inside a folder", () => {
  it.each([
    ["C:\\Work", "C:\\Work"],
    ["C:\\Work", "C:\\Work\\notes.md"],
    ["C:\\Work\\", "c:/work/drafts/one.md"],
    ["C:\\", "C:\\Work"],
    ["C:\\Work", "C:\\Work\\..notes"],
    ["C:\\Work", "C:\\Work\\Drafts\\..\\notes.md"],
    ["\\\\server\\share", "\\\\server\\share\\team\\plan.md"],
  ])("%s holds %s", (folder, path) => {
    expect(inside(folder, path)).toBe(true);
  });

  it.each([
    ["C:\\Work", "C:\\Workshop"],
    ["C:\\Work", "C:\\Work\\..\\secrets.txt"],
    ["C:\\Work", "C:\\"],
    ["C:\\Work", "D:\\Work\\notes.md"],
    ["\\\\server\\share", "\\\\server\\shared\\plan.md"],
  ])("%s does not hold %s", (folder, path) => {
    expect(inside(folder, path)).toBe(false);
  });

  it("is below a folder only when it is not the folder itself", () => {
    expect(below("C:\\Work", "C:\\Work\\notes.md")).toBe(true);
    expect(below("C:\\Work", "c:\\work\\")).toBe(false);
    expect(below("C:\\Work", "C:\\Workshop\\notes.md")).toBe(false);
  });
});
