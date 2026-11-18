/**
 * The conversation export's fake, for the tests of the packages above it
 * (ADR 0002). It writes no file.
 */

import type { ConversationExport } from "../src/index.js";

/** An export the person always cancels. */
export function fakeConversationExport(): ConversationExport {
  return { save: async () => ({ status: "cancelled" }) };
}
