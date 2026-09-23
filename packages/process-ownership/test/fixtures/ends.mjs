// A long output whose start and end both matter.
const size = Number(process.argv[2]);
process.stdout.write("HEAD");
process.stdout.write(Buffer.alloc(size, "x"));
process.stdout.write("TAIL");
