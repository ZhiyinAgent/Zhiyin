# 0005. The provider API key is a user setting, stored in the OS credential store

Status: accepted

## Context

The app is for people who do not have a terminal open, do not edit
config files, and should not need to know what an environment variable
is. A `.env` is a development answer to "where does the key live".

It is also the one piece of user data in this app that is unambiguously
a secret. Everything else — sessions, skills, settings — is recoverable
if leaked; a key is money and access.

**Assumptions this decision depends on** (revisit it if any changes):
- The user brings their own key; the app never ships or proxies one.
- Windows is the platform (ADR 0004), so its credential store is the one
  that has to work.

## Decision

The key is entered by the user in the app's settings and stored in the
operating system's credential store, via the `keyring` family of
bindings for Node (choose and pin the specific package when the settings
feature is built; the requirement is Windows Credential Manager support
without a bundled native toolchain).

It is never written to the app's own config file, never included in an
exported session or audit trail, and never logged. The model-client
feature carries the invariant that the key's bytes appear in nothing it
emits, with its own test; this decision is what that invariant protects.

An environment variable stays supported as an override, because it is
how tests and a developer machine supply a key without a UI. It is a
fallback, not the primary path, and its presence must be visible in
settings rather than silently shadowing what the user typed.

Rejected alternatives: a plaintext config file, which puts a live
credential in something that gets copied, synced and screenshotted;
encrypting it ourselves with a key we also have to store, which is the
same problem one level down; requiring an environment variable, which
fails the non-technical user this app exists for.

## Consequences

- The settings surface is on the critical path to a first working turn:
  without it, nobody can use the app. It is small, but it is not
  optional, and it needs the plain-language treatment everything
  user-facing gets — "your key is stored in Windows Credential Manager"
  means nothing to most people.
- A key that is present-but-wrong and a key that is absent are different
  states with different messages. The provider's 401 has to reach the
  user as something they can act on.
- The credential store can be unavailable or locked. That is a real
  failure path on a fresh machine and needs a real message, not a crash.
- Storage is per-OS-user, so the key survives reinstalls and does not
  need migrating. It is also not portable between machines, which is
  correct for a credential.
- **Still open:** whether more than one provider profile is supported at
  once. That is a settings-shape question and it waits for the UI work.
