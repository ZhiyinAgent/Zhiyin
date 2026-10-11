/**
 * Who answers for a tool call. The permission engine decides on it, and a
 * remote tool cannot gain a built-in tool's authority by taking its name.
 */
export type ToolOwner = "built-in" | "mcp" | "skill" | "plugin";

/** A tool as named to the agent and shown to the user. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /**
   * What a read-only specialist may be offered. Set by the app's own code, or
   * for a connector tool by the connection feature from its plugin's
   * declaration, never from a server's description of itself (ADR 0006).
   */
  readonly access?: "read" | "change";
}

/**
 * Whether the `bash` tool can run here. Absent a shell, it is a capability
 * that does not exist and is never advertised to the model — this is what a
 * person is told instead, so the gap is not silent.
 */
export type ShellAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: string;
      readonly installUrl: string;
    };

/**
 * Where OpenRouter's own error reference sends a person out of credits
 * (`/credits` redirects here permanently).
 */
export const OPENROUTER_CREDITS_URL = "https://openrouter.ai/settings/credits";

/** Where OpenRouter's authentication guide sends a person to manage keys. */
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys";

/** Where every release of Zhiyin is published, the newest first. */
export const RELEASES_URL = "https://github.com/ZhiyinAgent/Zhiyin/releases";

/**
 * Every external URL `openExternalUrl` may open. Fixed at build time, not
 * supplied at the call site's discretion — an allowlist, not a proxy for any
 * URL a renderer happens to have on hand.
 */
export const ALLOWED_EXTERNAL_URLS = [
  "https://git-scm.com/download/win",
  RELEASES_URL,
  OPENROUTER_CREDITS_URL,
  OPENROUTER_KEYS_URL,
  // Where each lab's keys are made and its billing kept, per platform, as the
  // lab's own documentation names them, or the platform's console where it
  // names no billing page. A provider names its pages; they open only once
  // they are listed here too.
  "https://platform.claude.com/settings/keys",
  "https://platform.claude.com/settings/billing",
  "https://platform.openai.com/settings/organization/api-keys",
  "https://platform.openai.com/settings/organization/billing",
  "https://z.ai/manage-apikey/apikey-list",
  "https://z.ai/manage-apikey/billing",
  "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
  "https://bigmodel.cn/",
  "https://platform.deepseek.com/api_keys",
  "https://platform.deepseek.com/",
  "https://platform.kimi.ai/console/api-keys",
  "https://platform.kimi.ai/docs/guide/account-and-payments",
  "https://platform.kimi.com/console/api-keys",
  "https://platform.kimi.com/docs/guide/account-and-payments",
  "https://platform.minimax.io/user-center/basic-information/interface-key",
  "https://platform.minimax.io/user-center/payment/balance",
  "https://platform.minimax.cn/user-center/basic-information/interface-key",
  "https://platform.minimax.cn/user-center/payment/balance",
  "https://platform.xiaomimimo.com/#/console/api-keys",
  "https://platform.xiaomimimo.com/#/console/recharge",
  "https://home.qwencloud.com/api-keys",
  "https://home.qwencloud.com/billing/overview",
  "https://platform.qianwenai.com/home/api-keys",
  "https://platform.qianwenai.com/home/",
  "https://console.mistral.ai/api-keys",
  "https://admin.mistral.ai/organization/billing",
  // Where each shipped connector's key is made, as the service's own setup
  // guide names it. A connector package names its page; it opens only once it
  // is listed here too.
  "https://github.com/settings/personal-access-tokens/new",
  "https://app.tavily.com/home",
  "https://www.alphaxiv.org/settings",
] as const;
