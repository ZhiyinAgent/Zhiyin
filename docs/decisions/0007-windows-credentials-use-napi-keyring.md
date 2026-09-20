# 0007. Windows credentials use @napi-rs/keyring

Status: accepted

## Context

ADR 0005 requires the provider key to live in the operating system credential
store and leaves the exact Node binding open. The application is Windows-only,
must not require a native compiler on the user's machine, and is packaged by
electron-builder.

Verified 2026-09-02 against the npm registry and the project's primary source:
`@napi-rs/keyring` 2.0.0 publishes prebuilt Windows x64, ia32, and arm64 native
packages, supports asynchronous credential entries, and exposes get, set, and
delete operations. electron-builder 26 includes production dependencies and
smart-unpacks native modules when assembling the application.

**Assumptions this decision depends on:**

- Windows remains the only supported platform (ADR 0004).
- One OpenRouter credential per Windows user is sufficient for the current
  single-provider settings model.
- The prebuilt native module remains compatible with the Electron runtime used
  by the packaged application.

## Decision

Use the pinned `@napi-rs/keyring` 2.0.0 package and its asynchronous entry API.
The credential entry uses the application service name and the provider name as
its account key. The binding is loaded only in the main process; the renderer
can submit a replacement or request removal but can receive only credential
status and source.

Keep the provider environment variable as a visible development override. It
takes precedence at read time but is never returned to the renderer.

Rejected alternatives: a separate bundled credential executable, which adds a
second binary lifecycle and IPC boundary; a synchronous binding, which can block
the Electron main process; and application-managed encryption, which merely
moves the key-storage problem.

## Consequences

- The desktop package has one native production dependency. Packaging must be
  verified whenever Electron, electron-builder, or the keyring package changes.
- A locked or inaccessible credential store is a normal typed failure state,
  not an application crash.
- Reinstalling the application does not remove the credential because Windows,
  not the application data directory, owns it.
- Removing the credential is explicit. The application never reads the secret
  back into a form merely to prove that it exists.
