// A drawing process that, like the real one, draws only what it was given:
// it opens any document as one Letter page, draws a page of one it has open as
// a stand-in PNG, and says a document it was never given is not open.
const open = new Set();
process.on("message", (request) => {
  if (request.kind === "open") {
    open.add(request.revision);
    process.send({
      id: request.id,
      ok: true,
      kind: "opened",
      pages: [{ width: 816, height: 1056 }],
    });
  } else if (request.kind === "release") {
    open.delete(request.revision);
    process.send({ id: request.id, ok: true, kind: "released" });
  } else if (!open.has(request.revision))
    process.send({ id: request.id, ok: false, failure: "not-open" });
  else
    process.send({
      id: request.id,
      ok: true,
      kind: "drawn",
      png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      width: request.width,
      height: Math.round((request.width * 1056) / 816),
    });
});
