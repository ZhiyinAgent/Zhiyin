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
   * What the person reads for the tool while a call to it is written, when
   * its name is not that: a connection's tool by the connection's name and
   * what it does. Set by the app's own code.
   */
  readonly label?: string;
  /**
   * What a read-only specialist may be offered. Set by the app's own code, or
   * for a connector tool by the connection feature from its plugin's
   * declaration, never from a server's description of itself (ADR 0012).
   */
  readonly access?: "read" | "change";
  /**
   * Offered only to the conversation's own model, never to a specialist: the
   * tool works the space beside the conversation, which a specialist never
   * has. Set by the app's own code.
   */
  readonly conversationOnly?: true;
  /**
   * Its answer says how what it works on stands now, whole: the parts as
   * built, the scene, the document compiled. Condensing carries its latest
   * answer word for word. Set by the app's own code.
   */
  readonly reportsState?: true;
  /**
   * How a call to it checks work: `runs` when it runs, compiles or previews
   * what was made, which checks every change before it; `shows` when its
   * answer shows what it wrote, which reads its own change back. A tool that
   * reports state checks as one that runs. Set by the app's own code.
   */
  readonly checksWork?: "runs" | "shows";
  /**
   * The toolkit it loads with, as `3d-rendering/surfacing`; none for a core
   * tool, offered whenever its plugin is active (ADR 0017). Set by the app's
   * own code.
   */
  readonly toolkit?: string;
  /**
   * The part it plays that the agent loop asks for by, never by its name:
   * `reads-text` reads a text file by `path`, a saved output or a pasted
   * text by its address, a page at a time; `writes-file` writes a file whole
   * from `path` and `content`. Set by the app's own code.
   */
  readonly role?: "reads-text" | "writes-file";
  /**
   * For a connection's tool, the connection's id and the tool's own name as
   * the connection lists it. Set by the connection feature; read this, never
   * the name the tool is offered under, whose form is the connection
   * feature's own.
   */
  readonly connection?: { readonly id: string; readonly tool: string };
}

/**
 * Whether the `bash` tool can run here. Absent a shell, or where commands
 * cannot be contained, it is a capability that does not exist and is never
 * advertised to the model — this is what a person is told instead, so the gap
 * is not silent.
 */
export type ShellAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: string;
      /** Where to get what is missing, when installing something helps. */
      readonly installUrl?: string;
    };

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
  // Where each provider's keys are made and its billing kept, per platform,
  // as its own documentation names them, or the platform's console where it
  // names no billing page. A provider names its pages; they open only once
  // they are listed here too.
  "https://openrouter.ai/settings/keys",
  "https://openrouter.ai/settings/credits",
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
