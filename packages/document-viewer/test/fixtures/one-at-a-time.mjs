// A drawing process that, like the real one, works through its requests one
// at a time in the order they came, each taking 600 ms of work. It opens any
// document as one Letter page.
let queue = Promise.resolve();
process.on("message", (request) => {
  queue = queue.then(async () => {
    const until = Date.now() + 600;
    while (Date.now() < until);
    process.send(
      request.kind === "open"
        ? {
            id: request.id,
            ok: true,
            kind: "opened",
            pages: [{ width: 816, height: 1056 }],
          }
        : { id: request.id, ok: true, kind: "released" },
    );
  });
});
