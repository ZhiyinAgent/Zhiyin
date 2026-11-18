/**
 * The keys an installer may be signed with (ADR 0027): Ed25519 public keys,
 * SubjectPublicKeyInfo in DER, base64, by key id. Apart from the model
 * list's keys, so a key that signs prices cannot sign code. Made with
 * `pnpm release:keys`; the private halves never come near the repository.
 */
export const releaseKeys: Readonly<Record<string, string>> = {
  "release-primary-2026-11":
    "MCowBQYDK2VwAyEAgw++AJmaTqd0Nv+7r0/5lCiSk/58wm2UkjvwH7FPRfc=",
  "release-backup-2026-11":
    "MCowBQYDK2VwAyEAJqgKkaX73PPRgSSR6BYhwRbJ9b2y+Wo3fQIK7FehFA8=",
};
