import { describe, expect, it } from "vitest";
import { reviewBrief } from "../src/index.js";

const legs = { id: "R1", check: "count", part: "/Leg_.*/", count: 4 };
const top = {
  id: "R2",
  says: "The top is 1.2 m wide",
  check: "size",
  part: "Top",
  min: [1.2, null, null],
};
const clearance = { id: "R3", check: "clearance", part: "Chair", min: 0.05 };

describe("a review's brief", () => {
  it("lists each requirement as first written with its latest measure, and those removed or changed since", () => {
    expect(
      reviewBrief({
        title: "Spec for Table in requirements.json",
        first: [legs, top, clearance],
        current: [legs, { ...top, min: [1.0, null, null] }],
        last: {
          R1: { holds: true },
          R2: { holds: false, margin: -0.2, unit: "m" },
        },
      }),
    ).toBe(
      [
        "## Spec for Table in requirements.json",
        "",
        "Each requirement as first written in this conversation, with its latest measure:",
        '- R1 (count), holds: {"part":"/Leg_.*/","count":4}',
        '- R2 (size), fails, 0.2 m short: "The top is 1.2 m wide" {"part":"Top","min":[1.2,null,null]}',
        '- R3 (clearance), removed since: {"part":"Chair","min":0.05}',
        "",
        "Changed since first written; judge the work by the first:",
        '- R2 now reads {"part":"Top","min":[1,null,null]}',
      ].join("\n"),
    );
  });

  it("names a requirement added since, and one never measured", () => {
    expect(
      reviewBrief({
        title: "Requirements in part.json",
        first: [legs],
        current: [legs, clearance],
        last: { R3: { holds: null } },
      }),
    ).toBe(
      [
        "## Requirements in part.json",
        "",
        "Each requirement as first written in this conversation, with its latest measure:",
        '- R1 (count), not measured: {"part":"/Leg_.*/","count":4}',
        "",
        "Added since first written:",
        '- R3 (clearance), could not be measured: {"part":"Chair","min":0.05}',
      ].join("\n"),
    );
  });
});
