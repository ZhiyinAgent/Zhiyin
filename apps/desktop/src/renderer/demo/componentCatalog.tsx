import { conversationEntries } from "./catalog/conversation.js";
import { userInputEntries } from "./catalog/user-input.js";
import { viewsEntries } from "./catalog/views.js";
import { actionsEntries } from "./catalog/actions.js";
import { appEntries } from "./catalog/app.js";
import { capabilitiesEntries } from "./catalog/capabilities.js";
import { artifactsEntries } from "./catalog/artifacts.js";
import { modelEntries } from "./catalog/model.js";
import { browserEntries } from "./catalog/browser.js";
export type { ComponentCatalogEntry } from "./catalog/entry.js";

export const componentCatalog = [
  ...conversationEntries,
  ...userInputEntries,
  ...viewsEntries,
  ...actionsEntries,
  ...appEntries,
  ...capabilitiesEntries,
  ...artifactsEntries,
  ...modelEntries,
  ...browserEntries,
];
