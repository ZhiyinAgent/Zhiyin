/**
 * The model the app talks to, as the person has set it up: the providers and
 * their keys, the models on offer and who serves them, and the model chosen. Nothing here
 * touches a conversation, so it sits beside the workspace rather than inside it.
 */

import type {
  ApiKeySaveOutcome,
  AppEvent,
  ModelCatalog,
  ModelProviderList,
  ProviderSettings,
  ProviderSummary,
  ProviderTarget,
} from "@zhiyin/contract";
import type { ModelClient, ProviderDirectory } from "@zhiyin/model-client";

/**
 * Which choice a lowered window was learned on: the provider and region, the
 * model and its upstreams.
 */
const choiceOf = (settings: ProviderSettings) =>
  JSON.stringify([
    settings.provider?.id,
    settings.provider?.region?.id,
    settings.model,
    [...(settings.providers ?? [])].sort(),
  ]);

export class ModelSettings {
  readonly #model: ModelClient;
  readonly #directory: ProviderDirectory | undefined;
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

  /**
   * `model` follows the choice; `directory` reaches every provider, for the
   * commands that name one. Without it, only the chosen one can be set up.
   */
  constructor(
    model: ModelClient,
    emit: (event: AppEvent) => void,
    directory?: ProviderDirectory,
  ) {
    this.#model = model;
    this.#emit = emit;
    this.#directory = directory;
  }

  /** The provider and region named, or the chosen ones when none is. */
  #account(target: ProviderTarget | undefined): ModelClient {
    if (!target) return this.#model;
    if (!this.#directory)
      throw new Error("Only the chosen provider can be set up here.");
    return this.#directory.for(target);
  }

  providers(): Promise<readonly ProviderSummary[]> {
    return this.#directory ? this.#directory.list() : Promise.resolve([]);
  }

  current(): ProviderSettings | undefined {
    return this.#current && this.#asPlanned(this.#current);
  }

  /** Settings with the window a refusal showed to be smaller, if one did. */
  #asPlanned(current: ProviderSettings): ProviderSettings {
    const lowered = this.#lowered;
    if (!lowered || lowered.choice !== choiceOf(current)) return current;
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
    this.#emit({
      kind: "providerSettingsChanged",
      data: this.#asPlanned(current),
    });
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
    this.#emit({
      kind: "providerSettingsChanged",
      data: this.#asPlanned(settings),
    });
  }

  /**
   * A key is checked with the provider before it is kept, and the answer says
   * which of the three things happened: kept and known good, refused and not
   * kept, or kept without being checked because the check itself could not be
   * made. The third is not a refusal and must not read as one.
   */
  async saveApiKey(
    apiKey: string,
    target?: ProviderTarget,
  ): Promise<ApiKeySaveOutcome> {
    const account = this.#account(target);
    let outcome: ApiKeySaveOutcome = { status: "accepted" };
    try {
      await account.setApiKey(apiKey);
    } catch (error) {
      const reason =
        error instanceof Error && error.message
          ? error.message
          : "The key could not be saved.";
      const stored = (await account.settings()).credential.status;
      outcome =
        stored === "configured"
          ? { status: "unverified", reason }
          : { status: "refused", reason };
    }
    await this.refresh();
    return outcome;
  }

  async clearApiKey(target?: ProviderTarget): Promise<void> {
    await this.#account(target).clearApiKey();
    await this.refresh();
  }

  models(target?: ProviderTarget): Promise<ModelCatalog> {
    return this.#account(target).models();
  }

  modelProviders(
    model: string,
    target?: ProviderTarget,
  ): Promise<ModelProviderList> {
    return this.#account(target).modelProviders(model);
  }

  async selectModel(
    model: string,
    providers: readonly string[],
    target?: ProviderTarget,
  ): Promise<void> {
    await this.#account(target).selectModel(model, providers);
    await this.refresh();
  }
}
