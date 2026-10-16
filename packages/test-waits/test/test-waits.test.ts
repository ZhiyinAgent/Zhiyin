import { describe, expect, it } from "vitest";
import { changed, until, watched } from "../src/index.js";

/** Whether a promise has settled by the time everything queued so far has run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  return done;
}

describe("waiting for what a test checks", () => {
  it("goes on at once when the condition already holds", async () => {
    await expect(until(() => true)).resolves.toBeUndefined();
  });

  it("looks again only when something says it changed, however long that takes", async () => {
    let ready = false;
    const waiting = until(() => ready);

    ready = true;
    expect(await settled(waiting)).toBe(false);
    changed();

    expect(await settled(waiting)).toBe(true);
  });

  it("is woken by each call on a watched object, and by each answer it gives", async () => {
    let calls = 0;
    let answer!: () => void;
    const service = watched({
      count: () => {
        calls += 1;
      },
      later: () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    });
    let answered = false;

    const counted = until(() => calls === 1);
    service.count();
    expect(await settled(counted)).toBe(true);

    const pending = service.later().then(() => {
      answered = true;
    });
    const waitingForAnswer = until(() => answered);
    answer();
    await pending;
    expect(await settled(waitingForAnswer)).toBe(true);
  });

  it("is woken by each item of a stream a watched object returns", async () => {
    let seen = 0;
    const model = watched({
      async *send() {
        yield "first";
        seen += 1;
        yield "second";
      },
    });

    const waiting = until(() => seen === 1);
    const stream = model.send();
    await stream.next();
    expect(await settled(waiting)).toBe(false);
    const second = await stream.next();

    expect(second.value).toBe("second");
    expect(await settled(waiting)).toBe(true);
  });

  it("is woken by each call of a watched function", async () => {
    let made = 0;
    const newId = watched(() => `id-${++made}`);
    const waiting = until(() => made === 1);

    expect(newId()).toBe("id-1");
    expect(await settled(waiting)).toBe(true);
  });

  it("answers, refuses and keeps its own state as the object it watches", async () => {
    class Counter {
      #count = 0;
      add(): number {
        return ++this.#count;
      }
      async refuse(): Promise<never> {
        throw new Error("Refused.");
      }
    }
    const counter = watched(new Counter());

    expect(counter.add()).toBe(1);
    expect(counter.add()).toBe(2);
    await expect(counter.refuse()).rejects.toThrow("Refused.");
  });
});
