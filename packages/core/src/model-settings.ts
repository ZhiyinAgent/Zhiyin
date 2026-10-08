/**
 * The model the app talks to, as the person has set it up: the provider key,
 * the models on offer and who serves them, and the model chosen. Nothing here
 * touches a conversation, so it sits beside the workspace rather than inside it.
 */

import type {
  ApiKeySaveOutcome,
  AppEvent,
  ModelCatalog,
  ModelProviderList,
  ProviderSettings,
} from "@zhiyin/contract";
import type { ModelClient } from "@zhiyin/model-client";

/** Which choice a lowered window was learned on: the model and its upstreams. */
const choiceOf = (settings: ProviderSettings) =>
  JSON.stringify([settings.model, [...(settings.providers ?? [])].sort()]);

export class ModelSettings {
  readonly #model: ModelClient;
  readonly #emit: (event: AppEvent) => void;
  /** Unknown until the model has been looked up in the provider's catalogue. */
  #current: ProviderSettings | undefined;
  #reads = 0;
  /**
   * The window learned from a provider's refusal as too long, for the rest of
   * the session and only for the choice it was refused on.
   */
  #lowered:
    | {
        readonly choice: string;
        readonly contextWindow: number;
        readonly refusedTokens: number;
      }
    | undefined;

  constructor(model: ModelClient, emit: (event: AppEvent) => void) {
    this.#model = model;
    this.#emit = emit;
  }

  current(): ProviderSettings | undefined {
    const current = this.#current;
    const lowered = this.#lowered;
    if (!current || !lowered || lowered.choice !== choiceOf(current))
      return current;
    if (lowered.contextWindow >= (current.contextWindow ?? Infinity))
      return current;
    return {
      ...current,
      contextWindow: lowered.contextWindow,
      refusedTokens: lowered.refusedTokens,
    };
  }

  /** What a turn asks of the model: what it accepts, and the window it has. */
  forTurns() {
    return {
      acceptsImages: () => this.current()?.acceptsImages === true,
      modelWindow: () => ({ model: "", ...this.current() }),
      lowerWindow: (contextWindow: number, refusedTokens: number) =>
        this.lowerWindow(contextWindow, refusedTokens),
    };
  }

  /**
   * Plans with a smaller window than the catalogue lists, because the provider
   * refused a request of `refusedTokens` as too long. Never raises it.
   */
  lowerWindow(contextWindow: number, refusedTokens: number): void {
    const current = this.#current;
    if (!current) return;
    if (contextWindow >= (this.current()?.contextWindow ?? Infinity)) return;
    this.#lowered = { choice: choiceOf(current), contextWindow, refusedTokens };
    this.#emit({ kind: "providerSettingsChanged", data: this.current()! });
  }

  /**
   * Reads the settings and tells the window. The read can be slow, so only the
   * latest one is kept: a read begun before a change never overwrites the
   * answer read after it.
   */
  async refresh(): Promise<void> {
    const read = ++this.#reads;
    const settings = await this.#model.settings();
    if (read !== this.#reads) return;
    this.#current = settings;
    this.#emit({ kind: "providerSettingsChanged", data: this.current()! });
  }

  /**
   * A key is checked with the provider before it is kept, and the answer says
   * which of the three things happened: kept and known good, refused and not
   * kept, or kept without being checked because the check itself could not be
   * made. The third is not a refusal and must not read as one.
   */
  async saveApiKey(apiKey: string): Promise<ApiKeySaveOutcome> {
    let outcome: ApiKeySaveOutcome = { status: "accepted" };
    try {
      await this.#model.setApiKey(apiKey);
    } catch (error) {
      const reason =
        error instanceof Error && error.message
          ? error.message
          : "The key could not be saved.";
      const stored = (await this.#model.settings()).credential.status;
      outcome =
        stored === "configured"
          ? { status: "unverified", reason }
          : { status: "refused", reason };
    }
    await this.refresh();
    return outcome;
  }

  async clearApiKey(): Promise<void> {
    await this.#model.clearApiKey();
    await this.refresh();
  }

  models(): Promise<ModelCatalog> {
    return this.#model.models();
  }

  modelProviders(model: string): Promise<ModelProviderList> {
    return this.#model.modelProviders(model);
  }

  async selectModel(
    model: string,
    providers: readonly string[],
  ): Promise<void> {
    await this.#model.selectModel(model, providers);
    await this.refresh();
  }
}
