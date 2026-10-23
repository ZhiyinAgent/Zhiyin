// Writes the given bytes exactly, as a console program in the OEM code page would.
process.stdout.write(Buffer.from(process.argv.slice(2).map(Number)));
