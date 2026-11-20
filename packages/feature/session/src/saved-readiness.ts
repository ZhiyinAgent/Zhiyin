/**
 * What a conversation keeps of its connectors' readiness: the plugin
 * directory's marks its requests start with, and the setup cards it showed.
 * The window draws a card without checking it again, so one in the wrong
 * shape would reach the interface as a crash rather than as damage.
 */

import type { ConnectorNeed } from "@zhiyin/contract";
import { oneOf } from "@zhiyin/value-checks";
import { optionalTrue } from "./saved-action-parts.js";
import { isRecord, optionalText } from "./saved-values.js";

const need = oneOf<ConnectorNeed>({
  key: true,
  "sign-in": true,
  install: true,
  "could-not-start": true,
  "switched-off": true,
});

function validNeeds(needs: unknown): boolean {
  return (
    needs === undefined ||
    (isRecord(needs) && Object.values(needs).every((value) => need(value)))
  );
}

/** The directory's marks, by plugin id. */
export function validReadinessSent(sent: unknown): boolean {
  return (
    sent === undefined ||
    (isRecord(sent) &&
      Object.values(sent).every(
        (marks) =>
          isRecord(marks) &&
          validNeeds(marks.needs) &&
          optionalTrue(marks.switchedOff),
      ))
  );
}

function validSetup(setup: unknown): boolean {
  return (
    setup === undefined ||
    (isRecord(setup) &&
      typeof setup.url === "string" &&
      typeof setup.keyName === "string" &&
      optionalText(setup.advice))
  );
}

/** A card that asked the person to set a connector up. */
export function validSetupSuggestion(suggestion: unknown): boolean {
  if (suggestion === undefined) return true;
  if (!isRecord(suggestion) || !isRecord(suggestion.plugin)) return false;
  const { plugin, connector } = suggestion;
  return (
    typeof plugin.id === "string" &&
    typeof plugin.name === "string" &&
    optionalTrue(plugin.switchedOff) &&
    (connector === undefined ||
      (isRecord(connector) &&
        typeof connector.id === "string" &&
        typeof connector.name === "string" &&
        (connector.needs === undefined || need(connector.needs)) &&
        validSetup(connector.setup) &&
        optionalText(connector.detail)))
  );
}
