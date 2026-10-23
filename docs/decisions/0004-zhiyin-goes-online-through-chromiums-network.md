# 0004. Zhiyin goes online through Chromium's network

Status: accepted

## Decision

- **Every request Zhiyin's own code sends goes through Chromium's network
  stack**, by `fetch` on an Electron session that keeps nothing on disk:
  model requests, key checks and model listings, connector calls, connector
  sign-ins and their refreshes, and toolchain downloads. Chromium reads
  Windows' certificate stores and Windows' proxy settings, so behind a
  company proxy that re-signs traffic with a root installed in Windows, or
  that Windows is set to use, the person takes no step of their own. A proxy
  script, automatic discovery and signing in to a proxy with the Windows
  account are expected to work as Electron documents them; they are not
  tried (see Assumptions).
- **The composition root hands the network in.** Each feature that goes
  online takes it as a function of the standard `fetch` shape and uses
  Node's `fetch` only when none is given: in tests, and in a build that is
  not installed when `ZHIYIN_TEST_NODE_NETWORK=1` asks for it, so tools that
  trace or replay a run by replacing Node's `fetch` still see every request.
  Lint refuses Node's global `fetch` in feature code outside those defaults,
  by name or as a property of `globalThis`, `global`, `window` or `self`. It
  does not catch a request made another way, such as through `node:https`,
  which no feature uses.
- **A request does not obey `NODE_TLS_REJECT_UNAUTHORIZED`.** Chromium never
  reads it, so a variable set for another program cannot make Zhiyin send a
  key to a host whose certificate failed.
- **`NODE_OPTIONS` is refused** (ADR 0001). The fuse that refuses it also
  drops `NODE_EXTRA_CA_CERTS`, which nothing needs.
- The programs Zhiyin runs, such as uv, pip and git, keep their own network
  code and are given the person's proxy and certificate variables.

## Why

Behind a company proxy that inspects encrypted traffic, the proxy re-signs
each connection with a root certificate installed in Windows. Node trusts only
the roots bundled with it, and reads no proxy setting, so every request sent
through Node fails a certificate check that reads as a lost connection.
Chromium's verifier reads certificates added to the Local Machine and Current
User stores (Chrome Root Store FAQ, read 2026-10-20), and its network stack is
the one Electron documents as using the system's proxy configuration and proxy
authentication.

Adding Windows' roots to Node's trusted list at startup fixes the certificate
half only. It leaves proxies, a proxy script and proxy sign-in unanswered, and
leaves `NODE_TLS_REJECT_UNAUTHORIZED` able to turn every check off.

## Rejected

- Windows' roots added to Node's trusted list at startup: the certificate half
  only, as above.
- Replacing the global `fetch` in the main process: every request would be
  covered without each feature taking the network, but a feature would then
  depend on an implementation it cannot see, and its tests would not show
  which network it uses.

## Assumptions

- Checked on 2026-10-20 in Electron 44's main process, on an in-memory
  session: an answer streams chunk by chunk, cancelling it closes its
  connection over HTTP/1.1 (over HTTP/2 Chromium is expected to end that one
  stream, not tried), `redirect: "error"` refuses a redirect, a key header
  arrives unchanged, and a self-signed certificate is refused with
  `NODE_TLS_REJECT_UNAUTHORIZED=0` set.
- Not tried: a real company proxy, a proxy script, or a proxy that asks for a
  password. A proxy that asks for a user name and password rather than the
  Windows account gets no prompt, and its requests fail.
- The hosts Zhiyin reaches speak HTTP/2, so many answers stream at once over
  one connection. Over HTTP/1.1 Chromium opens at most six connections to one
  host, and a seventh request waits for one to end.
- No connector or model endpoint listens on a port Chromium refuses as
  unsafe, such as 6000 or 6665 to 6669; one that does cannot be reached.
- Electron's `fetch` keeps the standard `Response` shape the features read:
  status, headers and a streamed body. Its `Response.url` is documented as
  wrong, and nothing reads it.
