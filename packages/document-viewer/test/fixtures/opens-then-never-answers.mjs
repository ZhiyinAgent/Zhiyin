// A drawing process that opens any document as one Letter page, then takes
// every later request and answers none, as one stuck reading a page would.
process.on("message", (request) => {
  if (request.kind === "open")
    process.send({
      id: request.id,
      ok: true,
      kind: "opened",
      pages: [{ width: 816, height: 1056 }],
    });
  else for (;;);
});
