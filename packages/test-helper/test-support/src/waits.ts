/**
 * How a test waits for what it is about to check. Code under test changes
 * nothing except by calling what surrounds it, or when an answer to one of
 * those calls comes back, so each such crossing wakes every wait to look
 * again. Nothing is asked by a clock: a wait whose condition never holds
 * ends at the test's own timeout, which names the test.
 */

const waiting = new Set<() => void>();

/** Wakes every wait to look again at what it waits for. */
export function changed(): void {
  for (const wake of [...waiting]) wake();
}

/**
 * Goes on once the condition holds, looking again each time something
 * changes. It looks once what is under way has run its course, so a test
 * goes on between two steps of the code under test, never inside one whose
 * rest only awaits promises; a wait on the disk between is another step.
 */
export async function until(holds: () => boolean): Promise<void> {
  while (!holds()) {
    await new Promise<void>((resolve) => {
      const wake = () => {
        waiting.delete(wake);
        resolve();
      };
      waiting.add(wake);
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
}

type Stream = AsyncIterator<unknown> & Partial<AsyncIterable<unknown>>;

function isStream(value: unknown): value is Stream {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Stream).next === "function" &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
      "function"
  );
}

/**
 * A promise that settles as the given one does, waking every wait as it
 * does. The caller holds a promise of its own, so one it never handles is
 * still reported as unhandled.
 */
function wakingWhenSettled<T>(promise: PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) =>
    promise.then(
      (value) => {
        resolve(value);
        changed();
      },
      (reason: unknown) => {
        reject(reason);
        changed();
      },
    ),
  );
}

function wakingStream(stream: Stream): AsyncIterableIterator<unknown> {
  const step =
    (method: "next" | "return" | "throw") =>
    (...args: unknown[]) => {
      const call = stream[method] as
        ((...given: unknown[]) => Promise<IteratorResult<unknown>>) | undefined;
      if (!call) return Promise.resolve({ done: true, value: args[0] });
      const result = call.apply(stream, args);
      changed();
      return wakingWhenSettled(result);
    };
  return {
    next: step("next"),
    return: step("return"),
    throw: step("throw"),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function wakingResult(result: unknown): unknown {
  changed();
  if (isStream(result)) return wakingStream(result);
  if (
    typeof result === "object" &&
    result !== null &&
    typeof (result as PromiseLike<unknown>).then === "function"
  )
    return wakingWhenSettled(result as PromiseLike<unknown>);
  return result;
}

/**
 * The same object or function, each call of it or of one of its methods
 * waking every wait, and so does each answer and each item of a stream it
 * returns. Methods run on the object itself, so its own private state works
 * as before.
 */
export function watched<T extends object>(object: T): T {
  return new Proxy(object, {
    apply(target, self, args: unknown[]) {
      return wakingResult(
        Reflect.apply(target as (...given: unknown[]) => unknown, self, args),
      );
    },
    get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        wakingResult(
          (value as (...given: unknown[]) => unknown).apply(target, args),
        );
    },
  });
}
