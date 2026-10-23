/**
 * One conversation's drawing process, from the core's side (ADR 0023).
 *
 * The process is started on first use and put in a container before it is
 * given anything: the container ends it with the application, holds it to a
 * memory limit, and is how it is ended when a page takes too long — closing
 * the container ends it whether it is running script or native code. Whatever
 * ends it, the requests it held are answered as failures, and the next request
 * starts a new process, which is given back the document it needs.
 *
 * A process nothing has asked anything of for a while is ended too (ADR 0023);
 * the documents are kept, so the next request reopens its own in a new one.
 */

import type {
  DrawingFormat,
  DrawingReply,
  DrawingRequest,
} from "./drawing-protocol.js";

/** A started drawing process, however it was started. */
export type DrawingProcess = {
  readonly pid: number;
  send(request: DrawingRequest): void;
  onReply(listener: (reply: DrawingReply) => void): void;
  onExit(listener: () => void): void;
  /** Only for a process that could not be contained; the container ends the rest. */
  kill(): void;
};

export type StartDrawingProcess = () => Promise<DrawingProcess>;

/** The part of process ownership a drawing process needs. */
export type DrawingContainment = {
  open(options: { readonly processMemoryLimit: number }): {
    contain(pid: number): void;
    close(): void;
  };
};

/** What came back, or why nothing did. */
export type HostReply =
  | DistributiveOmit<Extract<DrawingReply, { ok: true }>, "id">
  | {
      readonly ok: false;
      readonly failure:
        | Extract<DrawingReply, { ok: false }>["failure"]
        | "timed-out"
        | "ended"
        /** Never sent: the process had ended before its turn came. */
        | "unsent"
        | "uncontained";
    };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** A page that takes longer than this ends its process (ADR 0023). */
const defaultTimeoutMs = 10_000;
/**
 * Room for the process itself, a document, the largest image pdf.js will
 * decode (64 megapixels, four bytes each) and a page twice its size, with
 * margin. Past it the process is refused memory and ends.
 */
const defaultProcessMemoryLimit = 1024 * 1024 * 1024;
/** How long a process outlives the answer to its last request (ADR 0023). */
const defaultIdleMs = 60_000;

type Running = {
  readonly process: DrawingProcess;
  readonly container: { close(): void };
  /** Revisions this process has open, so a new one is given them again. */
  readonly open: Set<string>;
  readonly waiting: Map<number, (reply: HostReply) => void>;
  /**
   * The request last sent. The process works through its requests one at a
   * time, so the next is sent only once this one is answered, and each one's
   * time limit counts its own work, never the wait behind the others.
   */
  turn: Promise<unknown>;
  /** The process ended: whatever is still to be sent is answered as ended. */
  ended: boolean;
};

export class DrawingHost {
  readonly #start: StartDrawingProcess;
  readonly #containment: DrawingContainment;
  readonly #timeoutMs: number;
  readonly #processMemoryLimit: number;
  readonly #idleMs: number;
  #running: Promise<Running | undefined> | undefined;
  #next = 0;
  /** The document of each revision, kept to give a new process. */
  readonly #documents = new Map<
    string,
    { readonly format: DrawingFormat; readonly bytes: Uint8Array }
  >();
  #closed = false;
  /** Requests not yet answered; the idle time counts only while there are none. */
  #busy = 0;
  #idle: NodeJS.Timeout | undefined;

  constructor(options: {
    readonly start: StartDrawingProcess;
    readonly containment: DrawingContainment;
    readonly timeoutMs?: number;
    readonly processMemoryLimit?: number;
    /** How long a process outlives the answer to its last request. */
    readonly idleMs?: number;
  }) {
    this.#start = options.start;
    this.#containment = options.containment;
    this.#timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.#processMemoryLimit =
      options.processMemoryLimit ?? defaultProcessMemoryLimit;
    this.#idleMs = options.idleMs ?? defaultIdleMs;
  }

  open(
    revision: string,
    format: DrawingFormat,
    bytes: Uint8Array,
  ): Promise<HostReply> {
    return this.#serving(async () => {
      this.#documents.set(revision, { format, bytes });
      const running = await this.#process();
      if (!running) return { ok: false, failure: "uncontained" };
      const reply = await this.#ask(running, {
        kind: "open",
        revision,
        format,
        bytes,
      });
      if (reply.ok) running.open.add(revision);
      return reply;
    });
  }

  draw(
    revision: string,
    page: number,
    width: number,
    options: { readonly transparent?: true } = {},
  ): Promise<HostReply> {
    return this.#serving(() =>
      this.#onOpen({ kind: "draw", revision, page, width, ...options }),
    );
  }

  /** The text items on a PDF page. */
  text(revision: string, page: number): Promise<HostReply> {
    return this.#serving(() => this.#onOpen({ kind: "text", revision, page }));
  }

  /** A PDF page as a JPEG, `scale` times its size in points. */
  picture(
    revision: string,
    page: number,
    scale: number,
    quality: number,
  ): Promise<HostReply> {
    return this.#serving(() =>
      this.#onOpen({ kind: "picture", revision, page, scale, quality }),
    );
  }

  /** Asks about an open document, giving it first to a process that never had it. */
  async #onOpen(
    request: DistributiveOmit<
      Extract<DrawingRequest, { kind: "draw" | "text" | "picture" }>,
      "id"
    >,
  ): Promise<HostReply> {
    // A document let go of needs no process to say so.
    if (!this.#documents.has(request.revision))
      return { ok: false, failure: "not-open" };
    const running = await this.#process();
    if (!running) return { ok: false, failure: "uncontained" };
    const document = this.#documents.get(request.revision);
    if (!document) return { ok: false, failure: "not-open" };
    if (!running.open.has(request.revision)) {
      // A process that replaced one that ended has never seen this document.
      const reopened = await this.open(
        request.revision,
        document.format,
        document.bytes,
      );
      if (!reopened.ok) return reopened;
    }
    return this.#ask(running, request);
  }

  /**
   * Lets go of a document. It starts no process: one that is not running
   * holds no document, and the next one is never given this one. Nor does it
   * keep one running: letting go is not use, so it neither waits for nor
   * delays the idle end.
   */
  async release(revision: string): Promise<HostReply> {
    this.#documents.delete(revision);
    const running = await this.#running;
    if (!running || running.ended) return { ok: true, kind: "released" };
    running.open.delete(revision);
    return this.#ask(running, { kind: "release", revision });
  }

  /** Ends the process, and anything it was asked is answered as ended. */
  close(): void {
    this.#closed = true;
    clearTimeout(this.#idle);
    this.#documents.clear();
    void this.#end();
  }

  /** Runs a request, and ends the process once none has come for a while. */
  async #serving(request: () => Promise<HostReply>): Promise<HostReply> {
    clearTimeout(this.#idle);
    this.#busy += 1;
    try {
      return await request();
    } finally {
      this.#busy -= 1;
      if (this.#busy === 0 && !this.#closed) {
        this.#idle = setTimeout(() => this.#rest(), this.#idleMs);
        // Waiting to end a process never keeps the app running.
        this.#idle.unref();
      }
    }
  }

  /** Ends an idle process, keeping the documents for the next one. */
  #rest(): void {
    if (this.#busy > 0) return;
    const resting = this.#running;
    // Taken now, so a request that comes while it ends starts a new process.
    this.#running = undefined;
    void resting?.then((running) => running && this.#ended(running, "ended"));
  }

  /**
   * The running process, started if there is none. A process that could not
   * be started or contained is none; the next request tries again.
   */
  async #process(): Promise<Running | undefined> {
    if (this.#closed) return undefined;
    const launching = (this.#running ??= this.#launch().catch(() => undefined));
    const running = await launching;
    if (!running && this.#running === launching) this.#running = undefined;
    return running;
  }

  async #launch(): Promise<Running | undefined> {
    const process = await this.#start();
    const container = this.#containment.open({
      processMemoryLimit: this.#processMemoryLimit,
    });
    try {
      // Nothing is sent before this succeeds, so the limit is in force before
      // the process is given anything to draw.
      container.contain(process.pid);
    } catch {
      container.close();
      process.kill();
      return undefined;
    }
    const running: Running = {
      process,
      container,
      open: new Set(),
      waiting: new Map(),
      turn: Promise.resolve(),
      ended: false,
    };
    process.onReply((reply) => {
      const answer = running.waiting.get(reply.id);
      running.waiting.delete(reply.id);
      if (!answer) return;
      const rest: Record<string, unknown> = { ...reply };
      delete rest["id"];
      answer(rest as HostReply);
    });
    process.onExit(() => this.#ended(running, "ended"));
    if (this.#closed) {
      container.close();
      return undefined;
    }
    return running;
  }

  #ask(
    running: Running,
    request: DistributiveOmit<DrawingRequest, "id">,
  ): Promise<HostReply> {
    const id = ++this.#next;
    const asked = running.turn.then(
      () =>
        new Promise<HostReply>((resolve) => {
          if (running.ended) {
            resolve({ ok: false, failure: "unsent" });
            return;
          }
          const timer = setTimeout(() => {
            if (!running.waiting.has(id)) return;
            // Closing the container ends the process wherever it is stuck.
            void this.#ended(running, "timed-out", id);
          }, this.#timeoutMs);
          running.waiting.set(id, (reply) => {
            clearTimeout(timer);
            resolve(reply);
          });
          running.process.send({ ...request, id } as DrawingRequest);
        }),
    );
    running.turn = asked;
    return asked;
  }

  /**
   * Answers everything the process held — the request that timed out as
   * timed out, the rest as ended — and lets the next request start another.
   */
  async #ended(
    running: Running,
    failure: "timed-out" | "ended",
    culprit?: number,
  ): Promise<void> {
    running.ended = true;
    if ((await this.#running) === running) this.#running = undefined;
    running.container.close();
    const waiting = [...running.waiting];
    running.waiting.clear();
    for (const [id, answer] of waiting)
      answer({ ok: false, failure: id === culprit ? failure : "ended" });
  }

  async #end(): Promise<void> {
    const running = await this.#running;
    this.#running = undefined;
    if (running) await this.#ended(running, "ended");
  }
}
