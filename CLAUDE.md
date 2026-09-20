@AGENTS.md

## Claude Code specifics

- Never remove the `@AGENTS.md` import on line 1 — it is the only way
  Claude Code loads `AGENTS.md`. Keep shared instructions there, not
  here; this file is for Claude-Code-specific rules only, and must not
  duplicate `AGENTS.md` content.
- Read a feature's `README.md` before changing its public interface or
  its boundaries. The path-scoped rules in `.claude/rules/` cover
  invariants for routine edits; they do not cover cross-feature contract
  decisions.
