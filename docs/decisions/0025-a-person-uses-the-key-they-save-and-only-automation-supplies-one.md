# 0025. A person uses the key they save, and only an automated run supplies one, under Zhiyin's own names

Status: accepted

Supersedes the parts of ADR 0010, 0019 and 0024 that let an environment
variable supply a provider's key for development. The rest of each holds,
including the variables that fix a model, region or endpoint for a run.

## Decision

- **A request uses the key the person saved** on the Model page for that
  provider and platform.
- **An automated run may supply a key instead**, such as a test of the
  installed app or a benchmark run, through the platform's own variable:
  `ZHIYIN_<PROVIDER>_API_KEY`, or `ZHIYIN_<PROVIDER>_CN_API_KEY` for a
  mainland China platform. It comes before the saved key for that run and is
  never stored. The Model page shows that the key was set this way, and how
  to remove it.
- **No variable another tool reads is ever used**, such as
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.

## Why

Developers set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and their like for other
tools. Read by Zhiyin, such a variable bills that account without the person
choosing it, and keeps them from using the key they saved, since the Model
page cannot replace a key the environment supplies. Automated runs still need
a key that does not touch the person's Credential Manager entries, which a
test would otherwise overwrite. The cost is that every script starting
Zhiyin names its keys with the prefix.

## Rejected

- No environment keys at all: tests and benchmark runs would write their keys
  into the same Credential Manager entries as the person's, or the store
  would need a separate namespace for them.
- Environment keys in development builds only: the installed-app tests and
  benchmark runs start the packaged app.

## Assumptions

- No other tool sets variables whose names start with `ZHIYIN_`.
- Whoever sets one of them knows they are supplying a key.
