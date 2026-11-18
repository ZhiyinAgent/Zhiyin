/**
 * The one rule for where Zhiyin's browser may be sent, by the agent or by the
 * person: a web page, and nothing else.
 *
 * It is an allow-list, read after the address is parsed as the browser parses
 * it. A list of schemes to refuse would have to name every way a browser can
 * reach this computer's files or its own pages, and miss the next one.
 */

export type BrowserAddress =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

const webOnly =
  "Zhiyin's browser opens only web addresses, starting with https:// or http://.";

/** A scheme, as opposed to a host and its port such as `localhost:5173`. */
const scheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;

export function browserAddress(given: string): BrowserAddress {
  const text = given.trim();
  if (!text) return { ok: false, reason: webOnly };
  if (/^file:/i.test(text))
    return {
      ok: false,
      reason:
        "Use browser_preview with a workspace-relative file path to view local HTML. File URLs are not supported.",
    };
  // What a person types into an address bar often has no scheme: a local
  // server is reached over http, anything else over https.
  const written = scheme.test(text)
    ? text
    : `${local.test(text) ? "http" : "https"}://${text}`;
  let url: URL;
  try {
    url = new URL(written);
  } catch {
    return { ok: false, reason: `${text} is not a web address.` };
  }
  if (url.protocol === "https:" || url.protocol === "http:")
    return { ok: true, url: url.href };
  if (url.href === "about:blank") return { ok: true, url: url.href };
  return { ok: false, reason: webOnly };
}
