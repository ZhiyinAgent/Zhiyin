---
status: open
effort: High
blocked-by:
---

# The four package files pinned above the limit are split by concern

## What

Four files still hold a whole package's implementation in one place, each
pinned above the 600-line limit in `eslint.config.js`: `mcp/src/mcp.ts`
(1097), `capabilities/src/capabilities.ts` (622), `model-client/src/model-client.ts`
(614) and `recovery/src/recovery.ts` (640). Split each along the seams its own
code already has, lowering the pin as it goes, until each pin is deleted.

## Why

Moving them out of `index.ts` made the packages' entry points honest, but a
file named for its package is still one file doing several jobs. `mcp` is the
worst: connection lifecycle, credentials, tool listing and declarations are
independent, and the file's pin has been raised before.

## Done when

None of the four appears in the oversized-file pins, and each package's
existing tests pass unchanged.

## Notes

- `mcp` has 30 top-level declarations. Group them by what changes together,
  not by kind (types in one file, functions in another).
- Do not move behavior while splitting. A split that also changes what the
  code does cannot be reviewed as a split.
