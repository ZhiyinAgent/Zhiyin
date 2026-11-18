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
    "What was sent to the model, and its answers, are in the export of data to analyse.",
  ],
  trajectory: [
    credentials,
    "Removal reads text; it does not reach inside pictures.",
    "Pasted text is named in its message's step, not included; what the model read of it is in the answers to its calls.",
    "The instructions Zhiyin sends before the conversation are not kept, so the trajectory starts with the conversation; the standing instructions last sent are under agent.extra.",
  ],
} as const;
