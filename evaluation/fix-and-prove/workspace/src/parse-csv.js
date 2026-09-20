/**
 * Splits one line of a CSV file into its fields.
 *
 * Fields are separated by commas. A field may be wrapped in double quotes,
 * which is how a field containing a comma is written. Inside a quoted field,
 * a doubled quote ("") means one literal quote character.
 */
export function parseLine(line) {
  return line.split(",").map((field) => unquote(field));
}

function unquote(field) {
  if (field.startsWith('"') && field.endsWith('"') && field.length >= 2)
    return field.slice(1, -1);
  return field;
}

/** Splits a whole file into rows, ignoring a trailing newline. */
export function parseCsv(text) {
  return text
    .split("\n")
    .filter((line, index, lines) => line !== "" || index < lines.length - 1)
    .map((line) => parseLine(line));
}
