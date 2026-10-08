/**
 * The standard sign-in a connector's service offers (OAuth 2.1 with PKCE, as
 * the MCP authorization spec describes), run only when a person asks for it.
 *
 * The person signs in in their own browser. The service sends them back to an
 * address on this computer that Zhiyin listens on for this sign-in alone; the
 * code that arrives there is traded for tokens. Nothing is kept until that
 * succeeds, so a sign-in cancelled or abandoned leaves nothing behind.
 */

import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  auth,
  discoverOAuthServerInfo,
  type OAuthClientInformationMixed,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type OAuthTokens,
} from "@modelcontextprotocol/client";
import type { SignedIn } from "./signed-in.js";

export type SignInOptions = {
  /** Opens the person's own browser at the service's sign-in page. */
  readonly openBrowser: (url: string) => Promise<void>;
  /** How long to wait for the person; five minutes unless said otherwise. */
  readonly timeoutMs?: number;
};

/** Why a sign-in failed, in words a person can act on. */
export class SignInProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInProblem";
  }
}

/**
 * A sign-in failure as the person reads it. Only causes recognised here are
 * named: the service's own error text may carry anything.
 */
export function signInFailure(error: unknown, serverUrl: string): string {
  if (error instanceof SignInProblem) return error.message;
  const host = new URL(serverUrl).host;
  if (
    error instanceof Error &&
    error.message.includes("does not support dynamic client registration")
  )
    return `${host} does not let Zhiyin sign in on its own. Use a key from the service instead.`;
  return `${host} could not finish the sign-in.`;
}

export class SignInCancelled extends Error {
  constructor() {
    super("The sign-in was cancelled.");
    this.name = "SignInCancelled";
  }
}

/**
 * Whether the service offers a sign-in Zhiyin can use: it says where to sign
 * in, and lets an app register itself there. A service that only accepts apps
 * registered in advance is set up with a key instead.
 */
export async function offersSignIn(serverUrl: string): Promise<boolean> {
  try {
    const info = await discoverOAuthServerInfo(serverUrl);
    return Boolean(
      info.resourceMetadata?.authorization_servers?.length &&
      info.authorizationServerMetadata?.registration_endpoint,
    );
  } catch {
    return false;
  }
}

/**
 * A page the person is sent to must be one their browser shows as secure; a
 * plain address is allowed only on this computer, where nothing travels.
 */
function securePage(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  );
}

const landing = `<!doctype html><meta charset="utf-8"><title>Zhiyin</title>
<body style="font:16px system-ui;margin:48px">You can close this page and return to Zhiyin.</body>`;

type Callback = {
  readonly code?: string;
  readonly error?: string;
  readonly iss?: string;
};

/** Listens for the service sending the person back, once. */
async function listenForReturn(state: string): Promise<{
  readonly redirectUrl: string;
  readonly returned: Promise<Callback>;
  readonly server: Server;
}> {
  let answer: (callback: Callback) => void = () => {};
  const returned = new Promise<Callback>((resolve) => {
    answer = resolve;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (
      url.pathname !== "/callback" ||
      url.searchParams.get("state") !== state
    ) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(landing);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const iss = url.searchParams.get("iss");
    answer({
      ...(code ? { code } : {}),
      ...(error ? { error } : {}),
      ...(iss ? { iss } : {}),
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new SignInProblem(
      "Zhiyin could not listen for the sign-in to finish.",
    );
  return {
    redirectUrl: `http://127.0.0.1:${String(address.port)}/callback`,
    returned,
    server,
  };
}

/**
 * Signs in to the service behind one connection. Answers what to keep, or
 * throws `SignInCancelled` when the signal ends it, or an error saying why.
 */
export async function signIn(
  serverUrl: string,
  options: SignInOptions,
  signal: AbortSignal,
): Promise<SignedIn> {
  const state = randomBytes(16).toString("hex");
  const { redirectUrl, returned, server } = await listenForReturn(state);
  let client: OAuthClientInformationMixed | undefined;
  let tokens: OAuthTokens | undefined;
  let verifier = "";
  let discovery: OAuthDiscoveryState | undefined;
  let refusedPage = false;
  const provider: OAuthClientProvider = {
    redirectUrl,
    clientMetadata: {
      client_name: "Zhiyin",
      redirect_uris: [redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    state: () => state,
    clientInformation: () => client,
    saveClientInformation: (information) => {
      client = information;
    },
    tokens: () => tokens,
    saveTokens: (issued) => {
      tokens = issued;
    },
    redirectToAuthorization: async (url) => {
      if (!securePage(url)) {
        refusedPage = true;
        throw new SignInProblem(
          "The service's sign-in page is not a secure address, so it was not opened.",
        );
      }
      await options.openBrowser(url.href);
    },
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => verifier,
    saveDiscoveryState: (value) => {
      discovery = value;
    },
    discoveryState: () => discovery,
  };
  const ended = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new SignInProblem(
            "The sign-in was not finished in time. Try again when you are ready.",
          ),
        ),
      options.timeoutMs ?? 300_000,
    );
    const cancel = () => {
      clearTimeout(timer);
      reject(new SignInCancelled());
    };
    if (signal.aborted) cancel();
    signal.addEventListener("abort", cancel, { once: true });
    void returned.finally(() => clearTimeout(timer));
  });
  ended.catch(() => undefined);
  try {
    const started = await Promise.race([auth(provider, { serverUrl }), ended]);
    if (started !== "REDIRECT" || refusedPage)
      throw new SignInProblem("The service did not ask for a sign-in.");
    const callback = await Promise.race([returned, ended]);
    if (callback.error === "access_denied")
      throw new SignInProblem(
        `The sign-in was declined at ${new URL(serverUrl).host}.`,
      );
    if (!callback.code)
      throw new SignInProblem("The service sent no sign-in back.");
    await Promise.race([
      auth(provider, {
        serverUrl,
        authorizationCode: callback.code,
        ...(callback.iss ? { iss: callback.iss } : {}),
      }),
      ended,
    ]);
    if (!tokens || !client || !discovery)
      throw new SignInProblem("The service did not finish the sign-in.");
    return {
      tokens,
      issuedAt: Date.now(),
      client,
      authorizationServer: discovery.authorizationServerUrl,
      ...(discovery.authorizationServerMetadata
        ? { metadata: discovery.authorizationServerMetadata }
        : {}),
      ...(discovery.resourceMetadata?.resource
        ? { resource: discovery.resourceMetadata.resource }
        : {}),
    };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
