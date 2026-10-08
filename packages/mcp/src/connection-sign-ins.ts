import type { McpSignInOutcome } from "@zhiyin/contract";
import {
  offersSignIn,
  signIn,
  SignInCancelled,
  signInFailure,
  type SignInOptions,
} from "./sign-in.js";
import type { SignedIn } from "./signed-in.js";

/**
 * Which connections' services offer the standard sign-in, and the sign-ins
 * waiting in the person's browser. Without options no browser can be opened
 * here, and then nothing offers a sign-in.
 */
export class ConnectionSignIns {
  readonly #options: SignInOptions | undefined;
  readonly #offered = new Map<string, boolean>();
  readonly #waiting = new Set<string>();

  constructor(options?: SignInOptions) {
    this.#options = options;
  }

  /** Known to offer it, from an earlier look or a sign-in. */
  offered(id: string): boolean {
    return this.#offered.get(id) === true;
  }

  /** Asks a connection's service once whether it offers a sign-in. */
  async offers(id: string, url: string): Promise<boolean> {
    if (!this.#options) return false;
    let offered = this.#offered.get(id);
    if (offered === undefined) {
      offered = await offersSignIn(url);
      this.#offered.set(id, offered);
    }
    return offered;
  }

  /** Whether an address not saved as a connection offers a sign-in. */
  async addressOffers(url: string): Promise<boolean> {
    return this.#options !== undefined && (await offersSignIn(url));
  }

  /** A connection whose address changed or that is gone is asked again. */
  forget(id: string): void {
    this.#offered.delete(id);
  }

  /**
   * Runs one sign-in and says how it ended. `keep` stores what the service
   * issued; when it throws, nothing is kept and the sign-in failed.
   */
  async run(
    id: string,
    url: string,
    signal: AbortSignal,
    keep: (signedIn: SignedIn) => Promise<void>,
  ): Promise<McpSignInOutcome> {
    const options = this.#options;
    if (!options)
      return { status: "failed", reason: "Signing in is not available here." };
    if (this.#waiting.has(id))
      return {
        status: "failed",
        reason: "A sign-in to this service is already waiting in your browser.",
      };
    this.#waiting.add(id);
    try {
      await keep(await signIn(url, options, signal));
      this.#offered.set(id, true);
      return { status: "signed-in" };
    } catch (error) {
      if (error instanceof SignInCancelled) return { status: "cancelled" };
      return { status: "failed", reason: signInFailure(error, url) };
    } finally {
      this.#waiting.delete(id);
    }
  }
}
