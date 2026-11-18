@AGENTS.md

## Claude Code

- Keep the `@AGENTS.md` import on line 1: it is how Claude Code loads
  `AGENTS.md`. Shared instructions go there; this file holds only what is
  specific to Claude Code.
- The path-scoped rules in `.claude/rules/` load with the files they match and
  cover routine edits there. A change to a feature's public interface or
  boundaries still starts from that feature's `README.md`.
