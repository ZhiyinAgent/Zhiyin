import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The packages in each layer's folder, as the tree holds them. */
function packagesInTree() {
  const folders = (path) =>
    readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  return Object.fromEntries(
    folders("packages").map((layer) => [layer, folders(`packages/${layer}`)]),
  );
}

/**
 * The packages the architecture overview lists under each layer's folder:
 * a heading naming the folder, then one item per package, by its name.
 */
function packagesInOverview() {
  const text = readFileSync("docs/architecture/overview.md", "utf8");
  const section = text
    .split(/^## /m)
    .find((part) => part.startsWith("The packages"));
  const listed = {};
  let layer;
  for (const line of (section ?? "").split(/\r?\n/)) {
    const heading = /^\*\*`packages\/([a-z-]+)`\*\*$/.exec(line);
    if (heading) listed[(layer = heading[1])] = [];
    const item = /^- `([a-z-]+)`/.exec(line);
    if (item && layer) listed[layer].push(item[1]);
  }
  for (const names of Object.values(listed)) names.sort();
  return listed;
}

describe("the architecture overview", () => {
  it("lists every package under the folder of its layer, and nothing else", () => {
    expect(packagesInOverview()).toEqual(packagesInTree());
  });
});
