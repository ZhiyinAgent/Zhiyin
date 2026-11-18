/**
 * The keys a release is signed with ship in the app (ADR 0027): with none,
 * every installed copy would refuse every update. There is no key until the
 * maintainers make one, so this skips until then, and a release's gate
 * refuses the skip.
 */

import { describe, expect, it } from "vitest";
import { releaseKeys, releaseKeysOf } from "../src/index.js";

describe("the release keys", () => {
  it.skipIf(Object.keys(releaseKeys).length === 0)(
    "are a primary and a backup, each an Ed25519 key",
    () => {
      const ids = Object.keys(releaseKeys).sort();

      expect(ids).toHaveLength(2);
      expect(ids[0]).toMatch(/^release-backup-\d{4}-\d{2}$/);
      expect(ids[1]).toMatch(/^release-primary-\d{4}-\d{2}$/);
      expect(releaseKeysOf(releaseKeys).size).toBe(2);
    },
  );
});
