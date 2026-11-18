import type { ActionEffects, AskReason, ToolOwner } from "@zhiyin/contract";
import { whoseWord } from "@zhiyin/trust-rules";

/**
 * What a conversation holds that bears on a send (ADR 0012), worked out by the
 * agent loop from what entered it, never said by a tool.
 */
export type ConversationFacts = {
  /** Something not written by the person or Zhiyin has entered it. */
  readonly outsideContent: boolean;
  /** Its folder holds the person's files, or it read or reached something else private. */
  readonly privateWithinReach: boolean;
};

/** Decided as if outside content and something private had met. */
const unknownConversation: ConversationFacts = {
  outsideContent: true,
  privateWithinReach: true,
};

/** The exact, already-validated action the agent wants to perform. */
export type Action = {
  readonly kind: "tool";
  /**
   * The implementation that owns the action. A remote tool cannot gain a
   * built-in tool's authority by choosing the same name.
   */
  readonly owner: ToolOwner;
  readonly name: string;
  readonly arguments: unknown;
  readonly action: string;
  readonly target: string;
  readonly command: string;
  /**
   * Set by the connection feature, never by a connection: the call goes to a
   * connection Zhiyin ships, so its `effects` are declared by code the app
   * wrote, as a built-in tool's are.
   */
  readonly builtInConnection?: true;
  /**
   * What the action does, said whole by the code that carries it out (ADR
   * 0012), containment included: the engine never works out where an action
   * reaches from `target`. Trusted only from a built-in tool, a connection
   * Zhiyin ships, or a plugin's or skill's read of what it holds. Absent, the
   * action is decided as the worst it could do.
   */
  readonly effects?: ActionEffects;
  /** What the conversation holds; absent, the worst is assumed. */
  readonly conversation?: ConversationFacts;
  /**
   * Said by the agent loop: the address the action is sent to is found, whole,
   * in what the conversation already holds, so going there carries nothing the
   * model wrote.
   */
  readonly destinationSeen?: true;
  /**
   * Set by the connection feature: the call's effects come from a built-in
   * plugin's manifest, which Zhiyin wrote, so they are trusted.
   */
  readonly effectsDeclaredByZhiyin?: true;
  /**
   * What the person said in Settings of a tool of a connection Zhiyin does
   * not ship: that it only reads, or that it asks every time. The person's
   * word, recorded by the app, never the server's.
   */
  readonly personSays?: "only-reads" | "ask-each-time";
  /**
   * Said by the code that owns the tool: this call is asked about every time,
   * whatever its effects, and no grant for the conversation covers it (ADR
   * 0012).
   */
  readonly asksEachTime?: true;
};

/**
 * Which grant for the conversation may answer an `ask` in the person's place:
 * none; one for the action's destination; one for the file or folder it
 * reaches; one for each file it changes that Zhiyin could not copy; or one
 * for the tool.
 */
export type Covers =
  "never" | "destination" | "file-or-folder" | "uncopied-file" | "tool";

/**
 * A decision carries a policy reason for audit and failure handling. The agent
 * loop owns task-specific display copy.
 */
export interface Decision {
  readonly outcome: "allow" | "ask" | "deny";
  readonly reason: string;
  /** For a question, the grant that may cover it. */
  readonly covers?: Covers;
  /**
   * For a question, which part of the policy raised it, so the card can say
   * why the person is asked and what saying no protects in their words (ADR
   * 0012). The reason stays the audit's.
   */
  readonly why?: Why;
  /** For a question raised by several parts of the policy at once, each of them. */
  readonly parts?: readonly Why[];
}

/** Each part of the policy that asks. */
export type Why = AskReason;

const asks = (covers: Covers, why: Why, reason: string): Decision => ({
  outcome: "ask",
  covers,
  why,
  reason,
});

/**
 * What a grant for the conversation can be bound to, besides the effects: a
 * file grant names the files a call declared, so only a call whose every
 * declaration Zhiyin wrote can have one; a grant for a destination spans a
 * connection's tools, so only a call to a connection can.
 */
type Bindable = {
  readonly paths: boolean;
  readonly connection: boolean;
};

/**
 * The policy of ADR 0012 for an action whose effects are trusted: the
 * strictest part of what it does decides it.
 */
function byEffects(
  effects: ActionEffects,
  conversation: ConversationFacts,
  destinationSeen: boolean,
  bindable: Bindable,
): Decision {
  if (effects.lasting)
    return asks(
      "never",
      "runs-later",
      "This leaves something that runs later without anyone starting it, and requires an explicit decision each time.",
    );
  if (effects.runs === "full-access")
    return asks(
      "never",
      "full-access",
      "This runs code with the person's full access, and requires an explicit decision each time.",
    );
  // A change for good is covered by a grant only when all it cannot put back
  // is files it names, each too large to copy (ADR 0013).
  const uncopied =
    bindable.paths &&
    effects.changes === "workspace-for-good" &&
    !!effects.uncopied?.length;
  if (effects.changes === "workspace-for-good" && !uncopied)
    return asks(
      "never",
      "cannot-undo",
      "This changes the workspace in a way Zhiyin cannot put back, and requires an explicit decision each time.",
    );
  if (effects.actsAsPerson === "for-good")
    return asks(
      "never",
      "acts-for-good",
      "This acts as the person in a way that cannot be taken back, and requires an explicit decision each time.",
    );
  // Only words of the model's can carry what is private to where it chose;
  // an address the conversation already holds carries none.
  const modelWritten =
    effects.carries === undefined ||
    (effects.carries === "address" && !destinationSeen);
  if (
    effects.sends === "chosen" &&
    modelWritten &&
    conversation.outsideContent &&
    conversation.privateWithinReach
  )
    return asks(
      "never",
      "outside-and-private",
      "This sends what the model wrote to a destination it chose, while outside content and something private are both in the conversation, and requires an explicit decision each time.",
    );
  // A grant for acting as the person is bound to where the action lands; one
  // the call does not name could land anywhere.
  if (effects.actsAsPerson === "once" && !effects.destination)
    return asks(
      "never",
      "acts-as-you",
      "This acts as the person on an account without naming where, and requires an explicit decision each time.",
    );
  // Each part that asks once, with the grant that may cover it, or none.
  const coverable: [Covers, Why, string][] = [];
  if (uncopied)
    coverable.push([
      "uncopied-file",
      "cannot-undo",
      "This changes files Zhiyin could not copy first, so the change cannot be put back, and requires an explicit decision for each file.",
    ]);
  if (effects.actsAsPerson === "once")
    coverable.push(
      bindable.connection
        ? [
            "destination",
            "acts-as-you",
            "This acts as the person on an account, and requires an explicit decision for its destination.",
          ]
        : [
            "never",
            "acts-as-you",
            "This acts as the person on an account, not through a connection a grant for its destination could be bound to, and requires an explicit decision each time.",
          ],
    );
  // A grant for a file or folder outside covers changes there, by the paths
  // the call declared; nothing grants reading there.
  if (effects.changes === "elsewhere" || effects.reads === "elsewhere")
    coverable.push(
      effects.changes === "elsewhere" && bindable.paths
        ? [
            "file-or-folder",
            "outside-folder",
            "This reaches outside the selected folder, and requires an explicit decision for its file or folder.",
          ]
        : [
            "never",
            "outside-folder",
            "This reaches outside the selected folder, and requires an explicit decision each time.",
          ],
    );
  const [only, ...more] = coverable;
  if (more.length)
    return {
      ...asks(
        "never",
        "several",
        "This does several things that each require an explicit decision, so it requires one each time.",
      ),
      parts: coverable.map(([, why]) => why),
    };
  if (only) return asks(...only);
  return {
    outcome: "allow",
    reason:
      "Nothing this does needs a decision: it is contained, or Zhiyin can put it back.",
  };
}

export interface PermissionEngine {
  decide(action: Action): Promise<Decision>;
}

/**
 * Production policy (ADR 0012): an action is decided by the effects the code
 * that carries it out declared, and with what the conversation holds.
 *
 * The rule matches on the declaration, not on the tool's name. A name is
 * chosen by whoever writes the tool, so a name list grants authority to
 * anything willing to adopt the right word; a declaration is only trusted
 * because `owner` says the app wrote the code that made it. That is also why
 * an MCP tool's read-only annotation buys it nothing here: the server owns
 * that annotation, and it describes itself.
 *
 * Silence is not a claim: an action that declares no effects is decided as
 * the worst it could do, so a new tool cannot become automatic by forgetting
 * to say what it does.
 */
export class GuardedPermissionEngine implements PermissionEngine {
  async decide(action: Action): Promise<Decision> {
    const decision = byPolicy(action);
    if (action.asksEachTime)
      return decision.outcome === "ask"
        ? coveredByNothing(
            decision,
            "The code that owns this tool asks about this call every time, and no grant covers it.",
          )
        : {
            outcome: "ask",
            covers: "never",
            reason:
              "The code that owns this tool asks about this call every time, and no grant covers it.",
          };
    return decision;
  }
}

/** A question no grant answers, with why it is asked kept. */
function coveredByNothing(decision: Decision, reason: string): Decision {
  return decision.covers === "never"
    ? decision
    : { ...decision, covers: "never", reason };
}

/** The decision by what the action does and whose word says so. */
function byPolicy(action: Action): Decision {
  // A connection Zhiyin does not ship describes itself; its word buys
  // nothing, and each of its tools is decided by the person: by what they
  // said of it in Settings, or one decision for the conversation.
  const word = whoseWord(action.owner, action);
  if (word === "nothing")
    return action.personSays === "only-reads"
      ? {
          outcome: "allow",
          reason:
            "The person said in Settings that this connected tool only reads.",
        }
      : action.personSays === "ask-each-time"
        ? asks(
            "never",
            "you-asked-each-time",
            "The person asked in Settings to be asked about this connected tool every time.",
          )
        : asks(
            "tool",
            "connected-tool",
            "This action uses a connected tool and requires an explicit decision.",
          );
  if (!action.effects)
    return {
      outcome: "ask",
      covers: "never",
      reason:
        "This does not say what it does, so it is decided as the worst it could do, and requires an explicit decision each time.",
    };
  // A plugin or skill is trusted only to read what it holds.
  if (word === "reads") {
    const { reads, ...rest } = action.effects;
    const onlyReads =
      reads !== "elsewhere" &&
      Object.values(rest).every(
        (value) => value === "none" || value === false || value === undefined,
      );
    return onlyReads
      ? {
          outcome: "allow",
          reason: "This reads what an enabled plugin contains.",
        }
      : asks(
          "never",
          "plugin-beyond-read",
          "A plugin or skill may only read what it holds; anything more requires an explicit decision each time.",
        );
  }
  return byEffects(
    action.effects,
    action.conversation ?? unknownConversation,
    action.destinationSeen === true,
    { paths: word === "zhiyin", connection: action.owner === "mcp" },
  );
}
