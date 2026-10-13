/**
 * Checks that data from outside is one of the values a contract type names.
 *
 * A type is gone once the code runs, so a check needs the names written out.
 * They are written as the keys of an object, which the compiler holds to the
 * type: a name the type gains and the object lacks, or the reverse, does not
 * compile. The type is always given, as `oneOf<PlanStatus>({ … })`; left out,
 * no object is accepted.
 */

/** The object the names are written as; nothing is one without the type. */
type Held<Name extends string, Value> = [Name] extends [never]
  ? never
  : Readonly<Record<Name, Value>>;

/** Whether a value is one of a type's names. */
export function oneOf<Name extends string = never>(
  names: Held<NoInfer<Name>, true>,
): (value: unknown) => boolean {
  const known: object = names;
  return (value) => typeof value === "string" && Object.hasOwn(known, value);
}

/** How one kind's record is checked. */
type Shape = (value: Record<string, unknown>) => boolean;

/**
 * Whether a value is a record of one of a type's kinds, in the shape that kind
 * has. Each kind is checked as itself, and the kinds are held to the type as
 * `oneOf` holds its names.
 */
export function byKind<Kind extends string = never>(
  shapes: Held<NoInfer<Kind>, Shape>,
): (value: unknown) => boolean {
  const known: Readonly<Record<string, Shape>> = shapes;
  return (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return false;
    const record = value as Record<string, unknown>;
    const kind = record.kind;
    const shape =
      typeof kind === "string" && Object.hasOwn(known, kind)
        ? known[kind]
        : undefined;
    return shape !== undefined && shape(record);
  };
}
