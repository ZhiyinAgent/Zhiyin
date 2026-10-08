import type { UserInputRequest, UserInputResponse } from "./user-input.js";

/** A completed question and answer in the conversation timeline. */
export type TaskInteraction = {
  readonly id: string;
  readonly callId: string;
  readonly request: UserInputRequest;
  readonly response: UserInputResponse;
  readonly sequence: number;
};
