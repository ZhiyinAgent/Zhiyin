/**
 * What the model has been sent of a conversation, in the order it was sent.
 *
 * Kept so each request can start with the whole of the one before it, turn
 * after turn and after the app restarts: a provider reuses its cached copy of
 * a request's start only while the start is the same, byte for byte. Each entry
 * has an id, so a later change to one entry names it rather than rewriting the
 * list.
 */
export type ModelHistoryEntry =
  /** A message of the conversation, sent as its text. */
  | {
      readonly id: string;
      readonly kind: "message";
      readonly messageId: string;
    }
  /**
   * The model's words and the tool calls of one round, with the arguments that
   * ran. A call is kept once its result is; one refused quietly never is.
   */
  | {
      readonly id: string;
      readonly kind: "calls";
      /** The conversation message showing the same words, when shown. */
      readonly messageId?: string;
      readonly text: string;
      readonly calls: readonly {
        readonly id: string;
        readonly name: string;
        readonly arguments: string;
      }[];
    }
  /** A tool's answer to one call, as the model received it. */
  | {
      readonly id: string;
      readonly kind: "result";
      readonly callId: string;
      readonly name: string;
      readonly content: string;
    }
  /** Something Zhiyin told the model, as sent. */
  | { readonly id: string; readonly kind: "notice"; readonly content: string }
  /**
   * Pictures sent as themselves, named by where they are stored. Once let go,
   * the text says so and no pictures are left.
   */
  | {
      readonly id: string;
      readonly kind: "pictures";
      readonly text: string;
      readonly pictures: readonly {
        readonly mediaType: string;
        readonly source: string;
      }[];
    };
