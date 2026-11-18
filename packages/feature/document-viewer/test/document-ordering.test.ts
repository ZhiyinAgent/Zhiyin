import { describe, expect, it } from "vitest";
import type { DocumentPanelState } from "@zhiyin/contract";
import {
  nothingShown,
  step,
  type LoadRequest,
  type Ordering,
  type OrderingEffect,
  type OrderingEvent,
  type ShowOutcome,
} from "../src/document-ordering.js";

/*
 * Which document a panel shows is decided by a function of what it knows and
 * what happened. These tests hand it every order in which a few requests and
 * their steps can happen, and check what the panel shows and what each
 * request is answered, in every one of them.
 */

const root = "C:/work";
const clock = { now: 0, redrawIntervalMs: 1000 };

/** The files the walks ask for: where each is, and what is in it. */
const files: Record<
  string,
  { readonly revision: string; readonly pages: number } | "outside"
> = {
  "a.pdf": { revision: "rev-a", pages: 2 },
  "b.pdf": { revision: "rev-b", pages: 3 },
  "x.pdf": { revision: "rev-x", pages: 1 },
  "../secret.pdf": "outside",
};

/** A load asked for by name, as the person or the agent asks. */
function show(
  path: string,
  options: Omit<LoadRequest, "place" | "root"> = { asked: true },
): OrderingEvent {
  return {
    kind: "load",
    place: { path, name: path.split("/").at(-1) ?? path, folder: "" },
    root,
    ...options,
  };
}

const close: OrderingEvent = { kind: "closed" };

type Logged = {
  /** The request that was made, or the load whose step ended. */
  readonly who: string;
  readonly event: OrderingEvent;
  readonly effects: readonly OrderingEffect[];
};

/** Where a walk is: what the panel knows, what is left to ask, what is under way. */
type World = {
  readonly ordering: Ordering;
  readonly asks: readonly (readonly [string, OrderingEvent])[];
  /** The work each load is waiting on, by its number. */
  readonly work: ReadonlyMap<number, OrderingEffect>;
  /** Which request each load number is. */
  readonly names: ReadonlyMap<number, string>;
  readonly log: readonly Logged[];
};

function begin(asks: readonly (readonly [string, OrderingEvent])[]): World {
  return {
    ordering: nothingShown,
    asks,
    work: new Map(),
    names: new Map(),
    log: [],
  };
}

function apply(world: World, who: string, event: OrderingEvent): World {
  const { ordering, effects } = step(world.ordering, event, clock);
  const work = new Map(world.work);
  const names = new Map(world.names);
  if (event.kind === "load") names.set(ordering.numbered, who);
  for (const effect of effects) {
    if (
      effect.kind === "locate" ||
      effect.kind === "read" ||
      effect.kind === "open" ||
      effect.kind === "check-video"
    )
      work.set(effect.load, effect);
    if (effect.kind === "answer") work.delete(effect.load);
  }
  return {
    ...world,
    ordering,
    work,
    names,
    log: [...world.log, { who, event, effects }],
  };
}

/** What the outside world answers to a piece of work. */
function answerTo(effect: OrderingEffect): OrderingEvent {
  switch (effect.kind) {
    case "locate": {
      const file = files[effect.path];
      return {
        kind: "located",
        load: effect.load,
        found:
          file === "outside" || !file
            ? { kind: file ? "outside" : "missing" }
            : { kind: "found", path: `${root}/${effect.path}` },
      };
    }
    case "read": {
      const file = files[effect.name];
      if (!file || file === "outside") throw new Error(effect.name);
      return {
        kind: "read",
        load: effect.load,
        read: { bytes: new Uint8Array(), kind: "pdf", revision: file.revision },
      };
    }
    case "open": {
      const file = Object.values(files).find(
        (known) => known !== "outside" && known.revision === effect.revision,
      );
      if (!file || file === "outside") throw new Error(effect.revision);
      return {
        kind: "opened",
        load: effect.load,
        reply: {
          ok: true,
          kind: "opened",
          pages: Array.from({ length: file.pages }, () => ({
            width: 100,
            height: 100,
          })),
        },
      };
    }
    default:
      throw new Error(effect.kind);
  }
}

/**
 * Every order the world can go on in: the next request is made, or any load
 * under way finishes the step it is on. Requests are made in the order given.
 */
function* walks(world: World): Generator<World> {
  const [next, ...later] = world.asks;
  let moved = false;
  if (next) {
    moved = true;
    yield* walks(apply({ ...world, asks: later }, next[0], next[1]));
  }
  for (const [load, effect] of world.work) {
    moved = true;
    yield* walks(apply(world, world.names.get(load) ?? "?", answerTo(effect)));
  }
  if (!moved) yield world;
}

/** Each request's answers, by its name. */
function answers(world: World): Record<string, ShowOutcome[]> {
  const answered: Record<string, ShowOutcome[]> = {};
  for (const { effects } of world.log)
    for (const effect of effects)
      if (effect.kind === "answer") {
        const name = world.names.get(effect.load) ?? "?";
        (answered[name] ??= []).push(effect.outcome);
      }
  return answered;
}

/** The panels shown, in order, each with the step that showed it. */
function shown(
  world: World,
): { readonly at: number; readonly panel: DocumentPanelState }[] {
  return world.log.flatMap(({ effects }, at) =>
    effects.flatMap((effect) =>
      effect.kind === "show" ? [{ at, panel: effect.panel }] : [],
    ),
  );
}

/** Where a panel is: its status, and the document it names. */
function where(panel: DocumentPanelState): string {
  return panel.status === "closed" ? "closed" : `${panel.status} ${panel.path}`;
}

/**
 * The revisions the drawing process holds at the end: each one opened, until
 * it is let go of or the process ends.
 */
function held(world: World): string[] {
  const holding = new Set<string>();
  for (const { effects } of world.log)
    for (const effect of effects) {
      if (effect.kind === "open") holding.add(effect.revision);
      if (effect.kind === "release") holding.delete(effect.revision);
      if (effect.kind === "end-process") holding.clear();
    }
  return [...holding];
}

/** What holds at the end of every walk, whatever was asked. */
function expectSettled(world: World, description: string): void {
  const { ordering } = world;
  expect(ordering.loads.size, description).toBe(0);
  expect(ordering.opening.size, description).toBe(0);
  expect(ordering.panel.status, description).not.toBe("opening");
  // The process holds the revision shown, to draw its pages, and no other.
  expect(held(world), description).toEqual(
    ordering.panel.status === "shown" ? [ordering.panel.revision] : [],
  );
}

function describeWalk(world: World): string {
  return world.log.map(({ who, event }) => `${who}:${event.kind}`).join(", ");
}

describe("the order of what happens to a panel's documents", () => {
  it.each([
    ["a, then b, then close", ["a", "b", "close"]],
    ["a, then close, then b", ["a", "close", "b"]],
    ["close, then a, then b", ["close", "a", "b"]],
  ])(
    "shows the last thing asked for, whatever order two loads and a close finish in: %s",
    (_, order) => {
      const requests: Record<string, OrderingEvent> = {
        a: show("a.pdf"),
        b: show("b.pdf"),
        close,
      };
      let count = 0;
      for (const world of walks(
        begin(order.map((name) => [name, requests[name]!] as const)),
      )) {
        count += 1;
        const walk = describeWalk(world);
        expectSettled(world, walk);
        // Each load is answered once, as having gone as asked.
        expect(answers(world), walk).toEqual({
          a: [{ ok: true }],
          b: [{ ok: true }],
        });
        expect(where(world.ordering.panel), walk).toBe(
          order.at(-1) === "close" ? "closed" : "shown b.pdf",
        );
        const panels = shown(world);
        // Once b is shown, a never is.
        const bShown = panels.findIndex(
          ({ panel }) => where(panel) === "shown b.pdf",
        );
        if (bShown >= 0)
          expect(
            panels.slice(bShown).map(({ panel }) => where(panel)),
            walk,
          ).not.toContain("shown a.pdf");
        // After a close, nothing asked before it is shown, and no process is
        // started for it.
        const closedAt = world.log.findIndex(({ who }) => who === "close");
        const askedBefore = new Set(order.slice(0, order.indexOf("close")));
        const afterClose = world.log.slice(closedAt + 1);
        expect(
          afterClose.filter(
            ({ who, effects }) =>
              askedBefore.has(who) &&
              effects.some(
                (effect) => effect.kind === "show" || effect.kind === "open",
              ),
          ),
          walk,
        ).toEqual([]);
      }
      expect(count).toBeGreaterThan(10);
    },
  );

  it("keeps the bytes two loads of one file share until the one shown is drawn, whichever finishes first", () => {
    for (const world of walks(
      begin([
        ["shown", show("a.pdf")],
        ["written", show("a.pdf", {})],
      ]),
    )) {
      const walk = describeWalk(world);
      expectSettled(world, walk);
      expect(world.ordering.panel, walk).toMatchObject({
        status: "shown",
        path: "a.pdf",
        revision: "rev-a",
      });
    }
  });

  it.each([
    ["before", ["inside", "outside"]],
    ["after", ["outside", "inside"]],
  ])(
    "lets a request refused as outside the folder overtake nothing, asked %s a document",
    (_, order) => {
      const requests: Record<string, OrderingEvent> = {
        inside: show("a.pdf"),
        outside: show("../secret.pdf"),
      };
      for (const world of walks(
        begin(order.map((name) => [name, requests[name]!] as const)),
      )) {
        const walk = describeWalk(world);
        expectSettled(world, walk);
        expect(answers(world), walk).toEqual({
          inside: [{ ok: true }],
          outside: [
            {
              ok: false,
              reason:
                "../secret.pdf is outside the folder this conversation works in, so it is not shown.",
            },
          ],
        });
        expect(where(world.ordering.panel), walk).toBe("shown a.pdf");
        expect(
          shown(world).map(({ panel }) => where(panel)),
          walk,
        ).not.toContain("opening ../secret.pdf");
      }
    },
  );

  it.each([
    ["the document shown", "x.pdf"],
    ["another document", "b.pdf"],
    ["the document opening", "a.pdf"],
  ])(
    "goes back to what it showed when a page of %s that is not there is asked for while another opens",
    (_, missing) => {
      // x.pdf is shown before anything else is asked.
      let start = begin([["x", show("x.pdf")]]);
      for (const world of walks(start)) start = world;
      const before = start.ordering.panel;
      expect(where(before)).toBe("shown x.pdf");

      for (const world of walks({
        ...start,
        asks: [
          ["a", show("a.pdf")],
          ["page", show(missing, { asked: true, page: 99 })],
        ],
      })) {
        const walk = describeWalk(world);
        expectSettled(world, walk);
        expect(answers(world).page, walk).toMatchObject([{ ok: false }]);
        // What the panel showed last before the refused page took it: x.pdf,
        // unless a.pdf was shown by then.
        const refusedAt = world.log.findIndex(
          ({ who, event }) => who === "page" && event.kind === "located",
        );
        const aShownFirst = shown(world).some(
          ({ at, panel }) => at < refusedAt && where(panel) === "shown a.pdf",
        );
        expect(where(world.ordering.panel), walk).toBe(
          aShownFirst ? "shown a.pdf" : "shown x.pdf",
        );
      }
    },
  );

  it("owes a written document its redraw again when a page asked for by name is refused", () => {
    let world = begin([]);
    world = apply(world, "write", {
      kind: "written",
      places: [{ path: "a.pdf", name: "a.pdf", folder: "" }],
      root,
      keepShown: false,
    });
    for (const done of walks(world)) world = done;
    // Written again within its interval, its redraw waits.
    world = apply(world, "write again", {
      kind: "written",
      places: [{ path: "a.pdf", name: "a.pdf", folder: "" }],
      root,
      keepShown: false,
    });
    expect(world.log.at(-1)?.effects).toContainEqual({
      kind: "wait",
      path: "a.pdf",
      ms: 1000,
    });
    world = apply(world, "page", show("b.pdf", { asked: true, page: 9 }));
    for (const done of walks(world)) world = done;

    const waits = world.log.flatMap(({ effects }) =>
      effects.filter(
        (effect) => effect.kind === "wait" || effect.kind === "cancel-wait",
      ),
    );
    expect(waits).toEqual([
      { kind: "wait", path: "a.pdf", ms: 1000 },
      { kind: "cancel-wait", path: "a.pdf" },
      { kind: "wait", path: "a.pdf", ms: 1000 },
    ]);
    expect(where(world.ordering.panel)).toBe("shown a.pdf");
  });
});
