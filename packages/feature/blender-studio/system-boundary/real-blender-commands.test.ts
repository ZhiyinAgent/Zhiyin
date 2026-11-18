/**
 * What a real Blender 5.2 says of its commands as its session starts, held
 * to the tools: every choice, option, default and limit a tool's schema
 * states, and every number a tool's description states in words, is the one
 * Blender holds the call to. The description is also the one the unit tests
 * read as recorded, so they compare the tools with Blender's own. With
 * ZHIYIN_RECORD_COMMANDS=1 it records the description Blender gave, as
 * Prettier writes JSON, before comparing it.
 *
 *   $env:ZHIYIN_BLENDER = "…\blender.exe"; npx vitest run --project system-boundary packages/feature/blender-studio/system-boundary/real-blender-commands.test.ts
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "node:process";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { openProcessContainer } from "@zhiyin/sandbox";
import { containedSessionLaunch, studioTools } from "../src/index.js";
import {
  differencesFrom,
  type CommandsDescription,
} from "../src/blender-commands.js";

const blender = process.env["ZHIYIN_BLENDER"];
const sessionScript = fileURLToPath(
  new URL("../src/session/start.py", import.meta.url),
);
const recordedPath = fileURLToPath(
  new URL("../test/blender-commands.json", import.meta.url),
);

describe.runIf(blender)(
  "a real Blender 5.2's description of its commands",
  () => {
    const folders = new TemporaryFolders();
    let commands: CommandsDescription;

    beforeAll(async () => {
      const root = await folders.make("zhiyin-studio-commands-");
      const workspace = join(root, "workspace");
      const directory = join(root, "data");
      await mkdir(workspace, { recursive: true });
      await mkdir(join(directory, "previews"), { recursive: true });
      const launch = containedSessionLaunch(
        { open: openProcessContainer },
        { scripts: join(root, "session-scripts") },
      );
      const process = await launch({
        executable: blender!,
        script: sessionScript,
        directory,
        workspace,
        warm: join(directory, "previews", "warm.jpg"),
      });
      try {
        for (;;) {
          const line = await process.next();
          if (line === undefined)
            throw new Error(
              `Blender ended before it was ready.\n${await process.printed()}`,
            );
          const said = JSON.parse(line) as {
            ready?: boolean;
            commands?: CommandsDescription;
          };
          if (!said.ready) continue;
          commands = said.commands ?? {};
          break;
        }
      } finally {
        process.end();
        await process.ended;
      }
      if (env["ZHIYIN_RECORD_COMMANDS"] === "1")
        await writeFile(
          recordedPath,
          await format(JSON.stringify(commands), { filepath: recordedPath }),
        );
    }, 180_000);

    afterAll(() => folders.removeAll());

    it("holds every call to what the tools' schemas and descriptions state", () => {
      expect(differencesFrom(studioTools, commands)).toEqual([]);
    });

    it("is the description the unit tests read as recorded", async () => {
      const recorded: unknown = JSON.parse(
        await readFile(recordedPath, "utf8"),
      );
      expect(commands).toEqual(recorded);
    });
  },
);
