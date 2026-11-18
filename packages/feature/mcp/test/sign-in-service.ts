import { createServer, type IncomingMessage } from "node:http";

/**
 * A service that does what a real connector service with the standard sign-in
 * does: it describes where to sign in, registers an app that asks, sends the
 * person back with a code, trades the code for tokens, refreshes them, and
 * refuses its connection to anyone without a current token.
 */
export type SignInService = {
  readonly url: string;
  readonly registrations: () => number;
  /** Ends every token it gave, as an expiry or a revocation would. */
  readonly expireTokens: () => void;
  readonly refuseRefresh: () => void;
  readonly declineSignIn: () => void;
  /** Where its metadata says to send the person to sign in. */
  readonly signInPageAt: (url: string) => void;
  readonly close: () => Promise<void>;
};

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

export async function signInService(
  options: {
    readonly tokenLength?: number;
    /** Off for a service that only accepts apps registered in advance. */
    readonly registers?: boolean;
  } = {},
): Promise<SignInService> {
  let base = "";
  let registrations = 0;
  let issued = 0;
  let refuseRefresh = false;
  let decline = false;
  let authorizationEndpoint: string | undefined;
  const valid = new Set<string>();
  const refreshTokens = new Set<string>();

  function tokens() {
    issued += 1;
    const access = `access-${String(issued)}-`.padEnd(
      options.tokenLength ?? 24,
      "a",
    );
    const refresh = `refresh-${String(issued)}`;
    valid.add(access);
    refreshTokens.add(refresh);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: 3600,
    };
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", base);
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
      return json(200, {
        resource: `${base}/mcp`,
        authorization_servers: [base],
      });
    if (url.pathname === "/.well-known/oauth-authorization-server")
      return json(200, {
        issuer: base,
        authorization_endpoint: authorizationEndpoint ?? `${base}/authorize`,
        token_endpoint: `${base}/token`,
        ...(options.registers === false
          ? {}
          : { registration_endpoint: `${base}/register` }),
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (url.pathname === "/register" && request.method === "POST") {
      registrations += 1;
      const metadata = JSON.parse(await body(request)) as object;
      return json(201, {
        ...metadata,
        client_id: `client-${String(registrations)}`,
      });
    }
    if (url.pathname === "/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri") ?? "");
      if (decline) back.searchParams.set("error", "access_denied");
      else {
        back.searchParams.set("code", "the-code");
        back.searchParams.set("iss", base);
      }
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.writeHead(302, { Location: back.href });
      response.end();
      return;
    }
    if (url.pathname === "/token" && request.method === "POST") {
      const form = new URLSearchParams(await body(request));
      if (
        form.get("grant_type") === "authorization_code" &&
        form.get("code") === "the-code"
      )
        return json(200, tokens());
      const refresh = form.get("refresh_token") ?? "";
      if (
        form.get("grant_type") === "refresh_token" &&
        !refuseRefresh &&
        refreshTokens.delete(refresh)
      )
        return json(200, tokens());
      return json(400, { error: "invalid_grant" });
    }
    if (url.pathname === "/mcp") {
      const bearer = /^Bearer (.+)$/.exec(
        request.headers.authorization ?? "",
      )?.[1];
      if (!bearer || !valid.has(bearer)) {
        response.writeHead(401, {
          "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        });
        response.end();
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const message = JSON.parse(await body(request)) as {
        id?: number;
        method: string;
      };
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "service", version: "1" },
            }
          : message.method === "tools/call"
            ? { content: [{ type: "text", text: "found" }] }
            : { tools: [{ name: "search", inputSchema: { type: "object" } }] };
      return json(200, { jsonrpc: "2.0", id: message.id, result });
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  base = `http://127.0.0.1:${String(address.port)}`;
  return {
    url: `${base}/mcp`,
    registrations: () => registrations,
    expireTokens: () => valid.clear(),
    refuseRefresh: () => {
      refuseRefresh = true;
    },
    declineSignIn: () => {
      decline = true;
    },
    signInPageAt: (page) => {
      authorizationEndpoint = page;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** The person's browser: follows the sign-in page back to Zhiyin. */
export async function browserThatSignsIn(url: string): Promise<void> {
  await fetch(url, { redirect: "follow" }).then((response) =>
    response.body?.cancel(),
  );
}
