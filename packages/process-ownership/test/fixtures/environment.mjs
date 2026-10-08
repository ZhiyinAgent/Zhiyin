// Reports what it was given, so a test can see what reached it.
const names = process.argv.slice(2);
process.stdout.write(
  JSON.stringify(
    Object.fromEntries(names.map((name) => [name, process.env[name] ?? null])),
  ),
);
