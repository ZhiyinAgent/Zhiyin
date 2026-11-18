// A drawing process that opens any document as one Letter page, and answers
// the placed text of page 1 with an item missing its numbers and of page 2
// with a box of three, as one a document had taken over might.
process.on("message", (request) => {
  if (request.kind === "open")
    process.send({
      id: request.id,
      ok: true,
      kind: "opened",
      pages: [{ width: 816, height: 1056 }],
    });
  else if (request.kind === "placed")
    process.send({
      id: request.id,
      ok: true,
      kind: "placed",
      view: request.page === 1 ? [0, 0, 612, 792] : [0, 0, 612],
      items: [
        request.page === 1
          ? {
              text: "Hello",
              transform: [12, 0, 0, 12, "far"],
              width: 30,
              height: 12,
            }
          : {
              text: "Hello",
              transform: [12, 0, 0, 12, 72, 700],
              width: 30,
              height: 12,
            },
      ],
    });
  else process.send({ id: request.id, ok: true, kind: "released" });
});
