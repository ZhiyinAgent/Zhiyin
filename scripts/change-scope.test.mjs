import { describe, expect, it } from "vitest";
import { changeScope } from "./change-scope.mjs";

describe("the checks a change needs", () => {
  it("are the documentation checks when it changes only documentation", () => {
    expect(
      changeScope([
        "README.md",
        "CHANGELOG.md",
        "docs/getting-started.md",
        "docs/decisions/0032-a-decision.md",
        ".github/SECURITY.md",
        ".github/ISSUE_TEMPLATE/bug_report.yml",
        ".github/assets/banner-dark.webp",
      ]),
    ).toBe("docs");
  });

  it("are the whole gate when it changes anything the app, a test or a check reads", () => {
    for (const path of [
      "packages/feature/tools/README.md",
      "apps/desktop/src/main/index.ts",
      "scripts/gate.ps1",
      ".github/workflows/ci.yml",
      "THIRD_PARTY_LICENSES.md",
      "package.json",
      "notes.md/inside.ts",
    ])
      expect(changeScope(["README.md", path]), path).toBe("full");
  });

  it("are the whole gate when nothing says what changed", () => {
    expect(changeScope([])).toBe("full");
  });

  it("ignore blank lines in the list", () => {
    expect(changeScope(["", "README.md", "  "])).toBe("docs");
  });
});
