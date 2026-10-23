/**
 * How a model that lets thinking be turned off turns it off. Opus 5.5 and
 * Fable 5.1 refuse to; Sonnet 5.5 refuses `disabled` and goes without
 * up-front thinking under `between_tools`. Both are refused at `xhigh` or
 * `max` effort, which an "off" choice never names.
 */
export const thinkingOff: Readonly<
  Record<string, "disabled" | "between_tools">
> = {
  "claude-sonnet-5-5": "between_tools",
  "claude-haiku-5-5": "disabled",
};
