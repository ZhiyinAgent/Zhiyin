import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openProcessContainer } from "@zhiyin/process-ownership";
import { resolveGit } from "../src/index.js";
import { runGit } from "../src/run-git.js";

/**
 * git run for the person has no one at a terminal to answer it. A remote that
 * asks for a login must fail at once, not open a window behind the app or wait
 * out the timeout.
 */

const git = resolveGit();

describe.runIf(git && process.platform === "win32")(
  "git asked for a login",
  () => {
    it(
      "fails at once instead of waiting for someone to answer",
      { timeout: 30_000 },
      async () => {
        let asked = 0;
        const server = createServer((_, response) => {
          asked += 1;
          response.writeHead(401, {
            "WWW-Authenticate": 'Basic realm="private"',
          });
          response.end();
        });
        await new Promise<void>((resolve) =>
          server.listen(0, "127.0.0.1", resolve),
        );
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        try {
          const started = Date.now();

          const result = await runGit(
            git as string,
            await mkdtemp(join(tmpdir(), "zhiyin-git-login-")),
            ["ls-remote", `http://127.0.0.1:${port}/private.git`],
            undefined,
            { open: openProcessContainer },
          );

          expect(asked).toBeGreaterThan(0);
          expect(result.exitCode).not.toBe(0);
          expect(result.exitCode).not.toBeNull();
          // Refused because it was told not to ask, which is only true if the
          // settings reached the contained process.
          expect(result.stderr).toMatch(/terminal prompts disabled/);
          expect(Date.now() - started).toBeLessThan(15_000);
        } finally {
          server.close();
        }
      },
    );
  },
);
