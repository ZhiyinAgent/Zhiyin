// Tries each way out it is given and reports what happened, in order: run
// confined, it shows what the container's network reaches.
//   tunnel host port words  - an HTTPS tunnel through HTTPS_PROXY, then words
//   plain url               - a plain HTTP request through HTTPS_PROXY
//   direct host port        - a connection that ignores the proxy
//   resolve name            - a name looked up in the container
//   pipe name               - the named pipe opened directly
//   env name                - a variable's value
import { lookup } from "node:dns/promises";
import { connect } from "node:net";

const operations = JSON.parse(process.argv[2]);

function proxy() {
  const address = new URL(process.env.HTTPS_PROXY ?? "http://127.0.0.1:9");
  return { host: address.hostname, port: Number(address.port) };
}

const settle = (socket, start) =>
  new Promise((resolve) => {
    socket.setTimeout(10_000, () => {
      socket.destroy();
      resolve("timeout");
    });
    socket.once("error", (error) => resolve(error.code ?? error.message));
    start(resolve);
  });

const actions = {
  tunnel: (host, port, words) => {
    const socket = connect(proxy());
    return settle(socket, (resolve) => {
      let stage = "opening";
      let opened = "";
      socket.once("connect", () =>
        socket.write(
          `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`,
        ),
      );
      socket.on("data", (chunk) => {
        if (stage === "opening") {
          opened = String(chunk).split("\r\n")[0];
          if (!opened.includes(" 200 ")) {
            socket.destroy();
            return resolve(opened);
          }
          stage = "talking";
          return socket.write(words);
        }
        socket.destroy();
        resolve(`${opened} | ${chunk}`);
      });
    });
  },
  plain: (url) => {
    const socket = connect(proxy());
    return settle(socket, (resolve) => {
      socket.once("connect", () =>
        socket.write(
          `GET ${url} HTTP/1.1\r\nHost: ${new URL(url).host}\r\n\r\n`,
        ),
      );
      socket.once("data", (chunk) => {
        socket.destroy();
        resolve(String(chunk).split("\r\n")[0]);
      });
    });
  },
  direct: (host, port) => {
    const socket = connect({ host, port: Number(port) });
    return settle(socket, (resolve) =>
      socket.once("connect", () => {
        socket.destroy();
        resolve("connected");
      }),
    );
  },
  resolve: (name) =>
    lookup(name).then(
      (found) => found.address,
      (error) => error.code ?? error.message,
    ),
  pipe: (name) => {
    const socket = connect({ path: `\\\\.\\pipe\\${name}` });
    return settle(socket, (resolve) =>
      socket.once("connect", () => {
        socket.destroy();
        resolve("connected");
      }),
    );
  },
  env: (name) => process.env[name] ?? "",
};

const results = [];
for (const [name, ...args] of operations)
  results.push(await actions[name](...args));
process.stdout.write(JSON.stringify(results));
