import { conversationEntries } from "./catalog/conversation.js";
import { condensingEntries } from "./catalog/condensing.js";
import { userInputEntries } from "./catalog/user-input.js";
import { viewsEntries } from "./catalog/views.js";
import { actionsEntries } from "./catalog/actions.js";
import { toolCallEntries } from "./catalog/tool-call.js";
import { appEntries } from "./catalog/app.js";
import { capabilitiesEntries } from "./catalog/capabilities.js";
import { artifactsEntries } from "./catalog/artifacts.js";
import { modelEntries } from "./catalog/model.js";
import { browserEntries } from "./catalog/browser.js";
import { documentEntries } from "./catalog/documents.js";

export const componentCatalog = [
  ...conversationEntries,
  ...condensingEntries,
  ...userInputEntries,
  ...viewsEntries,
  ...actionsEntries,
  ...toolCallEntries,
  ...appEntries,
  ...capabilitiesEntries,
  ...artifactsEntries,
  ...modelEntries,
  ...browserEntries,
  ...documentEntries,
];
