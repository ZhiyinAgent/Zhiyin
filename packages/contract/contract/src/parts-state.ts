/** One part the CAD studio built, as the part view lists it. */
export type PreviewedPart = {
  /** The name the script gave it. */
  readonly name: string;
  /** Its size along x, y and z, in millimetres. */
  readonly size: readonly [number, number, number];
  /** Whether it is a valid solid. */
  readonly valid: boolean;
};

/** The parts a conversation's CAD studio built last, for the part view beside it. */
export type PartsPanelState = {
  /** Grows with every build shown, so the view knows a new model is there to fetch. */
  readonly sequence: number;
  readonly parts: readonly PreviewedPart[];
  /** The workspace script they were built from, when the build named one. */
  readonly script?: string;
};

export type ConversationPartsState = {
  readonly taskId: string;
  /** Nothing to show: no build yet, or going back removed the one shown. */
  readonly parts: PartsPanelState | null;
};

/** The parts as one glTF binary mesh, each named, for the part view to draw. */
export type PartModel = {
  readonly sequence: number;
  readonly data: Uint8Array;
};
