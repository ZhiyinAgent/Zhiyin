import type { ConnectionToolTreatment } from "@zhiyin/contract";

const connectionToolTreatments: readonly ConnectionToolTreatment[] = [
  "ask-once",
  "ask-each-time",
  "only-reads",
];

export function isConnectionToolTreatment(
  value: unknown,
): value is ConnectionToolTreatment {
  return connectionToolTreatments.some((treatment) => treatment === value);
}
