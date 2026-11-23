import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { Serial } from "@zhiyin/one-at-a-time";
import { shortened } from "@zhiyin/text-and-names";
import { realStaysInside } from "@zhiyin/workspace-containment";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".csv": "text/csv; charset=utf-8",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".avif": "image/avif",
};
const maxBytes = 20 * 1024 * 1024;
/** The most files not served one answer names; the rest are counted. */
const mostUnservedNamed = 20;

/** Why a file was not served, with the status the request is answered. */
class Unserved extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const outsideWorkspace =
  "Preview files must stay inside the selected workspace.";

/** Whether the workspace itself holds this file, without following it out. */
async function has(root: string, name: string): Promise<boolean> {
  return servedFile(root, name).then(
    () => true,
    () => false,
  );
}

/** Why the file system would not give a file, as the model is told it. */
function unreadable(error: unknown): Unserved {
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT") return new Unserved(404, "there is no such file");
  if (code === "EPERM" || code === "EACCES")
    return new Unserved(403, "permission to read it was refused");
  if (code === "EBUSY")
    return new Unserved(503, "another program has it open and locked");
  return new Unserved(
    500,
    `it could not be read${typeof code === "string" ? ` (${code})` : ""}`,
  );
}

/** What the file system answers, or why it would not, as a refusal. */
async function read<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    throw unreadable(error);
  }
}

/** Where a path really is, or a refusal saying why it cannot be known. */
const found = (path: string): Promise<string> => read(realpath(path));

/** A file the preview serves: where it really is, and the type it is sent as. */
async function servedFile(
  root: string,
  input: string,
): Promise<{ readonly file: string; readonly type: string }> {
  const segments = input.replaceAll("\\", "/").split("/");
  if (
    isAbsolute(input) ||
    segments.some(
      (part) => (part.startsWith(".") && part !== ".") || /[:\0]/.test(part),
    )
  )
    throw new Unserved(403, outsideWorkspace);
  let file = await found(resolve(root, input || "index.html"));
  if (!realStaysInside(root, file)) throw new Unserved(403, outsideWorkspace);
  if ((await read(stat(file))).isDirectory())
    file = await found(resolve(file, "index.html")).catch((error: unknown) => {
      throw error instanceof Unserved && error.status === 404
        ? new Unserved(404, "it is a folder with no index.html")
        : error;
    });
  if (!realStaysInside(root, file)) throw new Unserved(403, outsideWorkspace);
  const extension = extname(file).toLowerCase();
  const type = types[extension];
  if (!type)
    throw new Unserved(
      415,
      extension
        ? `the preview does not serve ${extension} files`
        : "the preview does not serve files without an extension",
    );
  return { file, type };
}

/** What the model is told of a file its page asked for and did not get. */
function unservedReason(error: Unserved): string {
  return error.message === outsideWorkspace
    ? "it is outside the workspace, or in a folder or file whose name starts with a dot"
    : error.message;
}

export class WorkspacePreview {
  readonly #workspace: () => string | undefined;
  #server: Server | undefined;
  #root = "";
  #selected = "";
  #origin = "";
  #token = "";
  readonly #queue = new Serial();
  /** What the preview's pages were not served, by the name they asked for. */
  readonly #unserved = new Set<string>();

  constructor(workspace: () => string | undefined) {
    this.#workspace = workspace;
  }

  async inspect(path: string): Promise<{ root: string; path: string }> {
    const selected = this.#workspace();
    if (!selected)
      throw new Error("Choose a workspace before previewing a file.");
    const root = await realpath(selected);
    try {
      const { file } = await servedFile(root, path);
      return { root, path: relative(root, file).replaceAll("\\", "/") };
    } catch (error) {
      if (!(error instanceof Unserved) || error.message === outsideWorkspace)
        throw error;
      throw new Error(`${path} cannot be previewed: ${error.message}.`, {
        cause: error,
      });
    }
  }

  /**
   * Each file the preview's pages asked for and were not served since this
   * was last asked, once, with why: so the model learns why part of its page
   * is missing, as it learns of refused addresses.
   */
  takeUnserved(): readonly string[] {
    const taken = [...this.#unserved];
    this.#unserved.clear();
    if (taken.length <= mostUnservedNamed) return taken;
    const more = taken.length - mostUnservedNamed;
    return [
      ...taken.slice(0, mostUnservedNamed),
      `${more} more ${more === 1 ? "file was" : "files were"} not served.`,
    ];
  }

  open(path: string, signal?: AbortSignal, binding?: string): Promise<string> {
    return this.#queue.run(async () => {
      signal?.throwIfAborted();
      const selection = this.#workspace();
      const checked = await this.inspect(path);
      if (binding !== undefined && binding !== JSON.stringify(checked))
        throw new Error(
          "The preview target changed after approval. Request approval again.",
        );
      signal?.throwIfAborted();
      if (!selection || selection !== this.#workspace())
        throw new Error("The workspace changed before preview started.");
      if (this.#server && this.#root !== checked.root) await this.#stop();
      if (!this.#server) {
        this.#root = checked.root;
        this.#selected = selection;
        this.#token = randomBytes(24).toString("hex");
        const server = createServer((request, response) => {
          void (async () => {
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.setHeader("Referrer-Policy", "no-referrer");
            if (request.method !== "GET" && request.method !== "HEAD") {
              response.writeHead(405).end();
              return;
            }
            if (
              request.headers.host !== new URL(this.#origin).host ||
              (request.headers.origin &&
                request.headers.origin !== this.#origin)
            ) {
              response.writeHead(403).end();
              return;
            }
            if (
              this.#workspace() !== this.#selected ||
              (await realpath(this.#selected)) !== this.#root
            ) {
              response
                .writeHead(409)
                .end("The workspace changed. Open a new preview.");
              return;
            }
            const url = new URL(request.url ?? "/", this.#origin);
            const prefix = `/${this.#token}/`;
            const tokenPath = url.pathname.startsWith(prefix);
            const cookie = request.headers.cookie
              ?.split("; ")
              .includes(`zhiyin-preview=${this.#token}`);
            if (!tokenPath && !cookie) {
              response.writeHead(403).end();
              return;
            }
            const asked = url.pathname.slice(tokenPath ? prefix.length : 1);
            let name = asked;
            // What the page asks for and is not given is named to the model.
            const notServed = (status: number, reason: string) => {
              const named = shortened(name, 200);
              this.#unserved.add(`${named} was not served: ${reason}.`);
              response.writeHead(status).end(`${name} was not served.`);
            };
            try {
              name = decodeURIComponent(asked);
            } catch {
              notServed(400, "its address is not a valid encoded path");
              return;
            }
            // Browsers ask for this on their own, and a workspace that has no
            // icon is not a page with something wrong with it. Answered with
            // "nothing here" rather than left to fail, so the console a person
            // or an agent reads shows only real problems.
            if (name === "favicon.ico" && !(await has(this.#root, name))) {
              response.writeHead(204).end();
              return;
            }
            const tooLarge = `it is larger than the ${maxBytes / 1024 / 1024} MB the preview serves`;
            let served;
            let bytes;
            try {
              served = await servedFile(this.#root, name);
              if ((await read(stat(served.file))).size > maxBytes)
                throw new Unserved(413, tooLarge);
              bytes = await read(readFile(served.file));
              if (bytes.length > maxBytes) throw new Unserved(413, tooLarge);
            } catch (error) {
              if (!(error instanceof Unserved)) throw error;
              notServed(error.status, unservedReason(error));
              return;
            }
            const { type } = served;
            if (tokenPath)
              response.setHeader(
                "Set-Cookie",
                `zhiyin-preview=${this.#token}; HttpOnly; SameSite=Strict; Path=/`,
              );
            response.setHeader("Content-Type", type);
            response
              .writeHead(200)
              .end(request.method === "HEAD" ? undefined : bytes);
          })().catch(() => {
            if (!response.headersSent) response.writeHead(403);
            response.end("This preview file is unavailable.");
          });
        });
        this.#server = server;
        try {
          await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
          });
          const address = server.address();
          if (!address || typeof address === "string")
            throw new Error("The preview could not start.");
          this.#origin = `http://127.0.0.1:${address.port}`;
        } catch (error) {
          await this.#stop();
          throw error;
        }
      }
      if (signal?.aborted) {
        await this.#stop();
        signal.throwIfAborted();
      }
      return `${this.#origin}/${this.#token}/${checked.path.split("/").map(encodeURIComponent).join("/")}`;
    });
  }

  /**
   * Whether a page at this address is this preview's, served now for the
   * workspace it was opened on. Its origin is a port on this computer the
   * preview holds, so no other page can be at it.
   */
  serves(address: string): boolean {
    if (!this.#server || !this.#origin) return false;
    if (this.#workspace() !== this.#selected) return false;
    try {
      return new URL(address).origin === this.#origin;
    } catch {
      return false;
    }
  }

  close(): Promise<void> {
    return this.#queue.run(() => this.#stop());
  }

  async #stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error && (!("code" in error) || error.code !== "ERR_SERVER_NOT_RUNNING")
          ? reject(error)
          : resolve(),
      ),
    );
    this.#origin = "";
    this.#token = "";
    this.#unserved.clear();
  }
}
