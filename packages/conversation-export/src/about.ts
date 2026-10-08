/** What an export says about itself: the app that wrote it, and when. */
export type ExportAbout = {
  readonly appVersion: string;
  readonly exportedAt: Date;
};

const credentials =
  "Known credential formats were removed and read “[credential omitted]”. Removal recognises the formats it knows; it cannot prove none remain.";
const attachments = "Pictures and attached files are named, not included.";

/** What each file leaves out, said in the file itself. */
export const leftOut = {
  html: [
    credentials,
    attachments,
    "Whole file contents are left out; a changed file is shown as the lines that changed.",
    "What was sent to the model, and its answers, are in the JSON export.",
  ],
  json: [credentials, attachments],
} as const;
