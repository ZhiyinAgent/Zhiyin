// A drawing process that commits 640 MB the moment it is asked anything, and
// answers only if it was allowed to.
process.on("message", (request) => {
  const kept = [];
  for (let index = 0; index < 20; index++)
    kept.push(Buffer.alloc(32 * 1024 * 1024, 1));
  process.send({
    id: request.id,
    ok: true,
    kind: "released",
    kept: kept.length,
  });
});
