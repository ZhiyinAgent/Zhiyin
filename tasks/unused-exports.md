---
status: open
effort: Low
blocked-by:
---

# No export is left that nothing imports

## What

`knip` reports 50 exports that no file imports, tests included. Remove the
`export`, or the declaration when nothing uses it either. Then take `exports`
and `types` off the exclusion in the `knip` script so the gate holds the line.

## Why

The gate's knip step covers unused files and dependencies only. An export
nothing imports is public surface nobody has agreed to keep: it reads as an
interface and gets depended on by accident. Most of the 50 are in `agent-loop`
(constants and helpers exported once for a test that later changed).

## Done when

`pnpm knip` passes with no `--exclude exports,types`.

## Notes

- Run `npx knip --include exports` for the list. Three are barrel re-exports
  from renderer modules (`ResultImage`, `StreamingMarkdown`,
  `PersonalInstructions`): decide whether the module means them to be public.
- An unexported constant that is then unused fails ESLint's unused-variable
  rule, so delete the declaration in that case.
