import { describe, expect, it } from "vitest";
import { documentCitation } from "./citation.js";

/** ADR 0018: which links in an answer are citations of a workspace document. */
describe("a citation in an answer", () => {
  it.each([
    ["q3.pdf#page=24", { path: "q3.pdf", page: 24 }],
    ["reports/q3.pdf#page=2", { path: "reports/q3.pdf", page: 2 }],
    ["reports/q3.pdf", { path: "reports/q3.pdf" }],
    ["charts/chart.png", { path: "charts/chart.png" }],
    [
      "My%20Report%20(final).pdf#page=3",
      { path: "My Report (final).pdf", page: 3 },
    ],
    ["rapport-%C3%A9t%C3%A9.pdf#page=1", { path: "rapport-été.pdf", page: 1 }],
    ["q3.pdf#page=7&zoom=50", { path: "q3.pdf", page: 7 }],
  ])("reads %s as a document and its page", (href, citation) => {
    expect(documentCitation(href)).toEqual(citation);
  });

  it.each([
    ["https://example.com/q3.pdf#page=2", "an address on the web"],
    ["mailto:someone@example.com", "another scheme"],
    ["file:///C:/q3.pdf", "a file address"],
    ["C:/work/q3.pdf", "a drive path"],
    ["/work/q3.pdf", "an absolute path"],
    ["\\\\server\\q3.pdf", "a network path"],
    ["../q3.pdf#page=2", "a path out of the folder"],
    ["reports/../../q3.pdf", "a path out of the folder, part way"],
    ["notes.md", "a file that is not a document"],
    ["q3.pdf#page=0", "page 0"],
    ["q3.pdf#page=two", "a page that is not a number"],
    ["q3.pdf#page=2.5", "a fraction of a page"],
    ["q3.pdf#zoom=50", "a fragment with no page"],
    ["q3.pdf?page=2", "a query"],
    ["%E0%A4%A.pdf", "a path that does not decode"],
    ["", "nothing"],
  ])("leaves %s alone: %s", (href) => {
    expect(documentCitation(href)).toBeUndefined();
  });
});
