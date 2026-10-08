# 0019. Data stays on this computer: keys in Credential Manager, the rest bounded in one folder and described plainly

Status: accepted

## Decision

- **Secrets go to Windows Credential Manager.** The provider key and each
  connector's token or sign-in are entered in the app and stored through
  `@napi-rs/keyring`, which only the main process loads. A key is checked
  against the provider's account endpoint before it is stored. A key the
  provider rejects replaces nothing; one that cannot be checked because the
  provider is unreachable is kept, and the person is told it was not checked.
  The window can set or clear a secret and learn whether one is stored and
  where it came from; it never receives the value. No key or token is written
  to Zhiyin's own files, an export or a log. For development, an environment
  variable may supply the provider key, and the Model page shows when it
  does.
- **Everything else is in one data folder**: conversations as they were sent
  to the model, pictures, pastes and saved outputs, file backups, the
  correction log, usage counts and the diagnostic log. Zhiyin sends nothing in
  it anywhere; what leaves the computer is what a conversation sends to its
  model and its connectors.
- **Retention is bounded and automatic.** Each kind has its own folder and
  limits, so one kind filling up never removes another's items:
  - File backups: 256 MiB in all, 10 MiB per file, 10 versions per path, 30
    days.
  - Pictures from tools: 128 MiB, 12 MiB each, 30 days. Pictures from
    connectors: 64 MiB, 12 MiB each, 30 days. Saved outputs: 256 MiB, 50 MiB
    each, 30 days.
  - What the person pasted or attached: 256 MiB of text and 256 MiB of
    pictures, with no age limit.
  - Corrections: the newest 5,000. Diagnostic log: 14 days.
- **The oldest items go first**, never the one just saved, and a conversation
  that refers to a removed item is told it was deleted to save space. Deleting
  a conversation deletes what it kept; backups age out by their limits.
- **The folder is described as it is.** Settings opens it and says in one line
  that conversations, pictures and file copies are kept there exactly as sent
  to the model, including any passwords or keys the assistant used, and that
  the folder stays on this computer. There is no page for deleting by kind.

## Why

A key is money and access; everything else Zhiyin keeps is private, but does
less harm if leaked. Credential Manager is per Windows user, survives a
reinstall, and keeps the key out of anything that gets copied, synced or
screenshotted.

The saved conversation keeps what was sent to the model, including credentials
a tool returned, because it is replayed. Since no copy on disk can be called
free of secrets, the app says what it keeps rather than implying a redaction
it cannot guarantee, and bounds the stores so nobody has to manage them by
hand.

## Rejected

- A plaintext config file for the key: a live credential in a file that gets
  copied.
- Encrypting the key with a key Zhiyin also stores: the same problem one level
  down.
- Requiring an environment variable: setup outside the app before it can work.
- A separate credential executable: a second binary lifecycle and IPC
  boundary.
- A synchronous binding: it blocks the main process.
- A page of counts, limits and deletion by kind: hard to read, and it implied
  more protection than exists.
- Unbounded backups and pictures: an archive of private content nobody chose to
  keep.

## Assumptions

- The person brings their own key; Zhiyin never ships or proxies one.
- `@napi-rs/keyring` keeps publishing prebuilt Windows binaries compatible with
  the Electron in use. Packaging is checked when either changes.
- The limits keep the folder small enough that nobody needs to delete by hand.
- The folder is as private as the Windows account and disk; it is not an
  encrypted vault.
