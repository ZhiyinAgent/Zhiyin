/**
 * The keys a newer model list may be signed with (ADR 0031), by key id:
 * Ed25519 public keys, SubjectPublicKeyInfo in DER, base64, as
 * `pnpm model-list:keys` prints them. The private halves are kept by the
 * maintainers, away from GitHub; `docs/tooling.md` says how.
 *
 * With no key here, every downloaded list is refused and the shipped one
 * stays in force.
 */
export const modelListKeys: Readonly<Record<string, string>> = {
  "primary-2026-10":
    "MCowBQYDK2VwAyEAsUq9YeDnYfPn1GXc0pjs7kD3KU1hs/GlKhARhS2KLs8=",
  "backup-2026-10":
    "MCowBQYDK2VwAyEAkCx9avXRqrDZCQ9kNiIxzRHZbz1pLe2Z7lOTEnn7Ex4=",
};
