// A drawing process that falls over at its first request.
process.on("message", () => process.exit(3));
