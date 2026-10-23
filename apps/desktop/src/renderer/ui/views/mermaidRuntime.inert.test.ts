import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mermaid stands in here: what it is asked to draw with, and the drawing it
 * returns, are what the test decides. The drawing holds every way model
 * written markup could run or reach out once shown in the window.
 */
const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

const { renderMermaid } = await import("./mermaidRuntime.js");

const crafted = [
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">',
  "<script>alert(2)</script>",
  '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">html</div></foreignObject>',
  '<iframe src="https://example.com/frame"></iframe>',
  '<object data="https://example.com/object"></object>',
  '<embed src="https://example.com/embed"/>',
  '<a href="javascript:alert(3)"><text>link</text></a>',
  '<a xlink:href="https://example.com/away"><text>away</text></a>',
  '<a href="#node-1"><text>inside</text></a>',
  '<g onclick="alert(4)" onmouseover="alert(5)"><rect width="5" height="5">',
  '<animate attributeName="href" to="javascript:alert(6)" begin="0s"/>',
  '<set attributeName="href" to="javascript:alert(7)" begin="0s"/>',
  "</rect></g>",
  '<use href="#node-1"/>',
  "</svg>",
].join("");

describe("a drawn diagram", () => {
  beforeEach(() => {
    mermaid.render.mockResolvedValue({ svg: crafted });
  });

  it("reaches the window with nothing that runs, loads or leads away, and keeps its links within itself", async () => {
    const svg = await renderMermaid("safety", "flowchart LR\nA --> B", "dark");
    const drawn = new DOMParser().parseFromString(svg, "image/svg+xml");

    for (const name of [
      "script",
      "foreignObject",
      "iframe",
      "object",
      "embed",
      "animate",
      "set",
    ])
      expect(drawn.getElementsByTagName(name), name).toHaveLength(0);
    const attributes = [...drawn.querySelectorAll("*")].flatMap((element) =>
      [...element.attributes].map((attribute) => [
        attribute.name,
        attribute.value,
      ]),
    );
    expect(attributes.filter(([name]) => /^on/i.test(name!))).toEqual([]);
    expect(
      attributes.filter(
        ([name, value]) => /(^|:)href$/i.test(name!) && !value!.startsWith("#"),
      ),
    ).toEqual([]);
    // Links to a part of the drawing itself still work.
    expect(
      attributes.filter(
        ([name, value]) => name === "href" && value === "#node-1",
      ),
    ).toHaveLength(2);
    expect(drawn.documentElement.textContent).toContain("inside");
  });

  it("is drawn by Mermaid in strict mode, with labels as SVG text", async () => {
    await renderMermaid("settings", "flowchart LR\nA --> B", "light");

    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", htmlLabels: false }),
    );
  });
});
