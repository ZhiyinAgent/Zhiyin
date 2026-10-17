// A drawing process that, like the real one, works through its requests one
// at a time in the order they came, each taking 600 ms of work.
let queue = Promise.resolve();
process.on("message", (request) => {
  queue = queue.then(async () => {
    const until = Date.now() + 600;
    while (Date.now() < until);
    process.send({ id: request.id, ok: true, kind: "released" });
  });
});
