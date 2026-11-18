import { describe, expect, it } from "vitest";
import {
  kindsOf,
  readRequirements,
  requirementKinds,
  sceneKinds,
  verdictDetail,
  verdictLines,
  type Checked,
} from "../src/index.js";

/** The kinds the 3D studio measures: the shared ones that mean the same on a mesh, and its own. */
const scene = kindsOf(
  ["size", "fits", "clearance", "separate", "wall"],
  sceneKinds,
);
const read = (requirements: unknown[], extra: Record<string, unknown> = {}) =>
  readRequirements(
    JSON.stringify({ ...extra, requirements }),
    "requirements.json",
    scene,
  );

describe("a 3D scene's requirements", () => {
  it("read the mug's proportions and relations", () => {
    const requirements = [
      {
        id: "S1",
        check: "size",
        part: "Body",
        range: [[80, 85], [80, 85], 95],
      },
      { id: "T1", check: "thickness", part: "Body", range: [4, 5] },
      { id: "T2", check: "thickness", part: "Handle", range: [8, 10] },
      { id: "W1", check: "width", part: "Handle", range: [12, 16] },
      {
        id: "R1",
        check: "reach",
        part: "Handle",
        from: "Body",
        range: [35, 45],
      },
      {
        id: "B1",
        check: "below",
        part: "Handle",
        other: "Body",
        sides: ["top", "top"],
        by: [10, 15],
      },
      { id: "J1", check: "joined", parts: ["Handle", "Body"] },
      { id: "F1", check: "rests_on", part: "Body" },
    ];
    expect(read(requirements, { object: "mug, 11 oz" })).toEqual({
      ok: true,
      object: "mug, 11 oz",
      requirements,
    });
  });

  it("read where parts are, how many there are, the faces drawn and what the camera sees", () => {
    expect(
      read([
        { id: "A1", check: "above", part: "Lamp", other: "Desk", by: [0, 2] },
        { id: "O1", check: "rests_on", part: "Mug", on: "Desk" },
        { id: "I1", check: "inside", part: "/Book_.*/", of: "Shelf" },
        { id: "I2", check: "inside", part: "Sofa", of: ["Walls", "Floor"] },
        { id: "I3", check: "inside", part: "Sofa", of: "/Wall_.*|Floor/" },
        { id: "C1", check: "count", part: "/Chair_.*/", range: [4, 6] },
        { id: "C2", check: "count", part: "Lamp", range: 1 },
        { id: "F1", check: "faces", max: 200000 },
        { id: "F2", check: "faces", parts: ["/Tree_.*/"], max: 50000 },
        { id: "V1", check: "in_view", parts: ["Mug"], camera: "Shot" },
      ]).ok,
    ).toBe(true);
  });

  it("refuse a field of the wrong form, saying what it takes", () => {
    expect(
      read([{ id: "T1", check: "thickness", part: "Handle", range: [10, 8] }]),
    ).toEqual({
      ok: false,
      reason:
        "requirements.json: T1: range is the thickness in mm, a number it must be or [least, most].",
    });
    expect(
      read([
        {
          id: "B1",
          check: "below",
          part: "Handle",
          other: "Body",
          sides: ["top", "middle"],
          by: 10,
        },
      ]),
    ).toEqual({
      ok: false,
      reason:
        'requirements.json: B1: sides is two of "top" and "bottom": the part\'s side, then the other\'s.',
    });
    expect(
      read([{ id: "C1", check: "count", part: "/Chair_.*/", range: [4.5, 6] }]),
    ).toEqual({
      ok: false,
      reason:
        "requirements.json: C1: range is how many there are, a whole number or [least, most].",
    });
    expect(
      read([{ id: "R1", check: "reach", part: "Handle", range: 40 }]),
    ).toEqual({
      ok: false,
      reason: "requirements.json: R1: a reach check needs from.",
    });
    expect(read([{ id: "I1", check: "inside", part: "Sofa", of: [] }])).toEqual(
      {
        ok: false,
        reason:
          "requirements.json: I1: of names what the part is inside: a part, or a list of 1 to 200 parts, each a name or a pattern between slashes such as /Wall_.*/, at most 200 characters; several are measured as one, as walls and a floor.",
      },
    );
    expect(read([{ id: "F1", check: "faces", max: 0 }])).toEqual({
      ok: false,
      reason:
        "requirements.json: F1: max is the most faces drawn, a whole number above 0.",
    });
  });

  it("read what goes into what over the animation, refusing an end before its start", () => {
    const requirements = [
      {
        id: "M1",
        check: "separate_in_motion",
        parts: ["Cloth", "/Plate_.*/"],
      },
      {
        id: "M2",
        check: "separate_in_motion",
        parts: ["Cloth", "Table"],
        max: 2,
        start: 0.5,
        end: 3,
        every: 2,
      },
    ];
    expect(read(requirements)).toEqual({ ok: true, requirements });
    expect(
      read([
        {
          id: "M1",
          check: "separate_in_motion",
          parts: ["Cloth", "Table"],
          start: 2,
          end: 1,
        },
      ]),
    ).toEqual({
      ok: false,
      reason:
        "requirements.json: M1: a separate_in_motion check gives an end after its start.",
    });
    expect(
      read([
        {
          id: "M1",
          check: "separate_in_motion",
          parts: ["Cloth", "Table"],
          every: 0,
        },
      ]),
    ).toEqual({
      ok: false,
      reason:
        "requirements.json: M1: every is how many frames apart the frames measured are, a whole number from 1, every frame when left out.",
    });
    expect(
      read([
        { id: "M1", check: "separate_in_motion", parts: ["Cloth"], max: -1 },
      ]),
    ).toEqual({
      ok: false,
      reason:
        "requirements.json: M1: max is the deepest in mm one part may go into another, 0 or more; left out, none may.",
    });
  });

  it("refuse an object that is not words", () => {
    expect(
      read([{ id: "F1", check: "faces", max: 10 }], { object: 11 }),
    ).toEqual({
      ok: false,
      reason:
        "requirements.json: object is what the design is, in words, at most 200 characters.",
    });
  });

  it("read the kinds another studio measures, refusing only what no studio does", () => {
    const requirements = [
      { id: "H1", check: "hole", part: "Bracket", diameter: 6, tolerance: 0.1 },
      { id: "S1", check: "size", part: "Bracket", max: [100, null, null] },
    ];
    expect(
      readRequirements(
        JSON.stringify({ requirements }),
        "requirements.json",
        scene,
        requirementKinds,
      ),
    ).toEqual({ ok: true, requirements });
    // Read elsewhere, a requirement is still held to its kind's fields.
    expect(
      readRequirements(
        JSON.stringify({
          requirements: [{ id: "H1", check: "hole", part: "Bracket" }],
        }),
        "requirements.json",
        scene,
        requirementKinds,
      ),
    ).toEqual({
      ok: false,
      reason: "requirements.json: H1: a hole check needs diameter.",
    });
    expect(
      readRequirements(
        JSON.stringify({ requirements: [{ id: "X1", check: "colour" }] }),
        "requirements.json",
        scene,
        requirementKinds,
      ),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(
        /^requirements\.json: X1: check is one of size, fits, clearance, separate, wall, thickness, .*in_view\.$/,
      ),
    });
  });
});

describe("an answer that lists only what does not hold", () => {
  const checked: Checked[] = [
    {
      id: "S1",
      holds: true,
      measured: "Body is 82 × 82 × 95 mm",
      margin: 2,
      unit: "mm",
    },
    {
      id: "T2",
      holds: false,
      measured: "Handle is 20 mm thick, where 8 to 10 mm is asked",
      margin: -10,
      unit: "mm",
    },
    { id: "H1", holds: null, why: "a hole is measured in the CAD studio" },
    { id: "H2", holds: null, why: "a hole is measured in the CAD studio" },
    {
      id: "V1",
      holds: true,
      measured: "Mug is in the frame",
      margin: 8,
      unit: "% of the frame",
    },
  ];
  const verdicts = {
    file: "requirements.json",
    title: "Spec for mug, 11 oz",
    since: "the last change",
    holding: "counted" as const,
  };

  it("counts what holds, then gives each failure and each reason one could not be checked once", () => {
    expect(verdictLines(verdicts, checked, {}, {})).toEqual([
      "Spec for mug, 11 oz: 2 of 3 checked hold, 2 not checked.",
      "- T2 fails: Handle is 20 mm thick, where 8 to 10 mm is asked; 10 mm past the limit.",
      "- H1, H2 not checked: a hole is measured in the CAD studio.",
    ]);
  });

  it("still shows the person every verdict, a share of the frame said as one", () => {
    const detail = verdictDetail(verdicts, checked, {}, {});
    expect(detail?.kind === "checks" && detail.items).toContainEqual({
      label: "V1",
      holds: true,
      note: "Mug is in the frame; 8% of the frame to spare",
    });
    expect(detail?.kind === "checks" && detail.items).toHaveLength(5);
  });
});
