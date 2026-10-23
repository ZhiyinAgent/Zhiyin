// A drawing process that takes every request and answers none, as one stuck
// on a page would. It spins rather than sleeps, so only termination ends it.
process.on("message", () => {
  for (;;);
});
