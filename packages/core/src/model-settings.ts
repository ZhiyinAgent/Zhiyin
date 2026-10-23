/**
 * The model the app talks to, as the person has set it up: the providers and
 * their keys, the models on offer and who serves them, and the model chosen. Nothing here
 * touches a conversation, so it sits beside the workspace rather than inside it.
 */

import {
  REASONING_EFFORTS,
  type ApiKeySaveOutcome,
  type AppEvent,
  type ModelCatalog,
  type ModelListState,
  type ModelProviderList,
  type ProviderSettings,
  type ProviderSummary,
  type ProviderTarget,
  type ReasoningSelection,
} from "@zhiyin/contract";
import type {
  ModelClient,
  ModelListControl,
  ProviderDirectory,
} from "@zhiyin/model-client";

/**
 * The least reasoning a model can be asked for: none where it answers without
 * it, otherwise the lowest effort it lists, and nothing where it lists neither
 * or its controls are unknown.
 */
function leastReasoningOf(
  reasoning: ProviderSettings["reasoning"],
): ReasoningSelection | undefined {
  if (reasoning?.status !== "available") return undefined;
  if (!reasoning.required) return { enabled: false };
  const lowest = REASONING_EFFORTS.find((effort) =>
    reasoning.efforts.includes(effort),
  );
  return lowest ? { enabled: true, effort: lowest } : undefined;
}

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

/**
 * How soon settings read without the model's catalogue entry are read again
 * by themselves; each later wait is twice the last, up to the longest.
 */
const firstReread = 5_000;
const longestReread = 300_000;

export class ModelSettings {
  readonly #model: ModelClient;
  readonly #directory: ProviderDirectory | undefined;
  readonly #emit: (event: AppEvent) => void;
  readonly #modelChanged: () => void;
  readonly #modelList: ModelListControl | undefined;
  /** Unknown until the model has been looked up in the provider's catalogue. */
  #current: ProviderSettings | undefined;
  #reads = 0;
  /** The newest read, until it lands. */
  #newest: Promise<void> | undefined;
  #reread: ReturnType<typeof setTimeout> | undefined;
  #rereadWait = firstReread;
  #stopped = false;
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
   * `modelChanged` is told when the model, or whether it sees pictures,
   * changed: what some tools offer follows both. `modelList` is Zhiyin's
   * model list, which the labs answer from: the settings are read again
   * whenever another list comes into force.
   */
  constructor(
    model: ModelClient,
    emit: (event: AppEvent) => void,
    directory?: ProviderDirectory,
    hooks: {
      readonly modelChanged?: () => void;
      readonly modelList?: ModelListControl;
    } = {},
  ) {
    this.#model = model;
    this.#emit = emit;
    this.#directory = directory;
    this.#modelChanged = hooks.modelChanged ?? (() => {});
    this.#modelList = hooks.modelList;
    this.#modelList?.onChanged(() => {
      if (!this.#stopped) void this.refresh().catch(() => undefined);
    });
  }

  /** Whether what the model accepts is known: not while its lookup failed. */
  #known(): boolean {
    return this.#current !== undefined && this.#current.lookupFailed !== true;
  }

  /** Whether the chosen model sees pictures; nothing while that is not known. */
  seesPictures(): boolean | undefined {
    return this.#known() ? this.#current?.acceptsImages === true : undefined;
  }

  /**
   * Reads the settings again where what the model accepts is not known. A
   * later read that overtakes this one is waited for too, since only the
   * newest is kept.
   */
  async readIfUnknown(): Promise<void> {
    if (this.#known()) return;
    await this.refresh().catch(() => undefined);
    while (!this.#known() && this.#newest)
      await this.#newest.catch(() => undefined);
  }

  /** Reads nothing again by itself from now on: the app is closing. */
  stop(): void {
    this.#stopped = true;
    this.#settled();
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
      leastReasoning: () => leastReasoningOf(this.current()?.reasoning),
      reasoningControls: () => this.current()?.reasoning,
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
   * answer read after it. Settings read without the model's catalogue entry
   * are read again by themselves, at growing intervals, until it answers.
   */
  async refresh(): Promise<void> {
    const reading = this.#read();
    this.#newest = reading;
    const landed = () => {
      if (this.#newest === reading) this.#newest = undefined;
    };
    reading.then(landed, landed);
    return reading;
  }

  async #read(): Promise<void> {
    const read = ++this.#reads;
    let settings: ProviderSettings;
    try {
      settings = await this.#model.settings();
    } catch (error) {
      if (read === this.#reads) this.#rereadLater();
      throw error;
    }
    if (read !== this.#reads) return;
    const before = this.#current;
    this.#current = settings;
    if (settings.lookupFailed) this.#rereadLater();
    else this.#settled();
    if (
      before?.model !== settings.model ||
      before?.acceptsImages !== settings.acceptsImages
    )
      this.#modelChanged();
    this.#emit({
      kind: "providerSettingsChanged",
      data: this.#asPlanned(settings),
    });
  }

  #rereadLater(): void {
    if (this.#reread || this.#stopped) return;
    const wait = this.#rereadWait;
    this.#rereadWait = Math.min(wait * 2, longestReread);
    this.#reread = setTimeout(() => {
      this.#reread = undefined;
      void this.refresh().catch(() => undefined);
    }, wait);
    // A wait for the catalogue never keeps the app from closing.
    this.#reread.unref?.();
  }

  #settled(): void {
    if (this.#reread) clearTimeout(this.#reread);
    this.#reread = undefined;
    this.#rereadWait = firstReread;
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
    let outcome: ApiKeySaveOutcome;
    try {
      outcome = await this.#account(target).setApiKey(apiKey);
    } catch (error) {
      outcome = {
        status: "refused",
        reason:
          error instanceof Error && error.message
            ? error.message
            : "The key could not be saved.",
      };
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

  #list(): ModelListControl {
    if (!this.#modelList) throw new Error("No model list is kept here.");
    return this.#modelList;
  }

  async modelList(): Promise<ModelListState> {
    return this.#list().state();
  }

  checkModelList(): Promise<ModelListState> {
    return this.#list().check();
  }

  setModelListUpdates(enabled: boolean): Promise<ModelListState> {
    return this.#list().setUpdates(enabled);
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
