import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { staysInside } from "@zhiyin/workspace-containment";

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
};
const maxBytes = 20 * 1024 * 1024;

/** Whether the workspace itself holds this file, without following it out. */
async function has(root: string, name: string): Promise<boolean> {
  return containedFile(root, name).then(
    () => true,
    () => false,
  );
}

async function containedFile(root: string, input: string): Promise<string> {
  const segments = input.replaceAll("\\", "/").split("/");
  if (
    isAbsolute(input) ||
    segments.some(
      (part) => (part.startsWith(".") && part !== ".") || /[:\0]/.test(part),
    )
  )
    throw new Error("Preview files must stay inside the selected workspace.");
  let file = await realpath(resolve(root, input || "index.html"));
  if (!staysInside(root, file))
    throw new Error("Preview files must stay inside the selected workspace.");
  if ((await stat(file)).isDirectory())
    file = await realpath(resolve(file, "index.html"));
  if (!staysInside(root, file))
    throw new Error("Preview files must stay inside the selected workspace.");
  if (!types[extname(file).toLowerCase()])
    throw new Error("This file type is not supported by the static preview.");
  return file;
}

export class WorkspacePreview {
  readonly #workspace: () => string | undefined;
  #server: Server | undefined;
  #root = "";
  #selected = "";
  #origin = "";
  #token = "";
  #queue: Promise<unknown> = Promise.resolve();

  constructor(workspace: () => string | undefined) {
    this.#workspace = workspace;
  }

  async inspect(path: string): Promise<{ root: string; path: string }> {
    const selected = this.#workspace();
    if (!selected)
      throw new Error("Choose a workspace before previewing a file.");
    const root = await realpath(selected);
    const file = await containedFile(root, path);
    return { root, path: relative(root, file).replaceAll("\\", "/") };
  }

  open(path: string, signal?: AbortSignal, binding?: string): Promise<string> {
    return this.#serialize(async () => {
      signal?.throwIfAborted();
      const selection = this.#workspace();
      const checked = await this.inspect(path);
      if (binding !== undefined && binding !== JSON.stringify(checked))
        throw new Error(
          "The preview target changed after approval. Request approval again.",
        );
      signal?.throwIfAborted();
      if (selection !== this.#workspace())
        throw new Error("The workspace changed before preview started.");
      if (this.#server && this.#root !== checked.root) await this.#stop();
      if (!this.#server) {
        this.#root = checked.root;
        this.#selected = selection!;
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
            const name = decodeURIComponent(
              url.pathname.slice(tokenPath ? prefix.length : 1),
            );
            // Browsers ask for this on their own, and a workspace that has no
            // icon is not a page with something wrong with it. Answered with
            // "nothing here" rather than left to fail, so the console a person
            // or an agent reads shows only real problems.
            if (name === "favicon.ico" && !(await has(this.#root, name))) {
              response.writeHead(204).end();
              return;
            }
            const file = await containedFile(this.#root, name);
            if ((await stat(file)).size > maxBytes) {
              response.writeHead(413).end("Preview file is too large.");
              return;
            }
            const bytes = await readFile(file);
            if (bytes.length > maxBytes) {
              response.writeHead(413).end();
              return;
            }
            if (tokenPath)
              response.setHeader(
                "Set-Cookie",
                `zhiyin-preview=${this.#token}; HttpOnly; SameSite=Strict; Path=/`,
              );
            response.setHeader(
              "Content-Type",
              types[extname(file).toLowerCase()]!,
            );
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

  close(): Promise<void> {
    return this.#serialize(() => this.#stop());
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
  }

  #serialize<T>(action: () => Promise<T>): Promise<T> {
    const work = this.#queue.then(action);
    this.#queue = work.catch(() => undefined);
    return work;
  }
}
