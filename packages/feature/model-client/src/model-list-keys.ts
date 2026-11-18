/**
 * The keys a newer model list may be signed with (ADR 0027), by key id:
 * Ed25519 public keys, SubjectPublicKeyInfo in DER, base64, as
 * `pnpm model-list:keys` prints them. The private halves are kept by the
 * maintainers, away from GitHub; `docs/maintainers.md` says how.
 *
 * With no key here, every downloaded list is refused and the shipped one
 * stays in force.
 */
export const modelListKeys: Readonly<Record<string, string>> = {
  "primary-2026-11":
    "MCowBQYDK2VwAyEA/tyMDtc+DjzaQbzV4lNSlokbScG/xgkOmgj2vj9czhY=",
  "backup-2026-11":
    "MCowBQYDK2VwAyEA6YK89xdOlnT+YU2z7/+LZbcujKpUk0HhIvbhb7boM7A=",
};
