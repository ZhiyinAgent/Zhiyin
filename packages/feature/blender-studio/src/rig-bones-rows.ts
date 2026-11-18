/** How blender_rig's bones and ready rig read in an approval. */

import {
  list,
  names,
  point,
  record,
  row,
  text,
  type Args,
  type Row,
} from "./approval-words.js";

const plural = (count: number, one: string) =>
  `${count} ${one}${count === 1 ? "" : "s"}`;

/** One bone as a person reads it: its name and where its ends go. */
function boneWords(value: unknown): string {
  const bone = record(value);
  const name = text(bone["name"]) ?? "?";
  const ends = [
    point(bone["head"]) ? `from ${point(bone["head"])}` : undefined,
    point(bone["tail"]) ? `to ${point(bone["tail"])}` : undefined,
    text(bone["parent"]) ? `under ${text(bone["parent"])}` : undefined,
  ].filter(Boolean);
  return ends.length ? `${name} ${ends.join(" ")}` : name;
}

/** One list edit as a person reads it. */
function editWords(value: unknown): string {
  const edit = record(value);
  const bone = text(edit["bone"]) ?? "?";
  const name = text(edit["name"]);
  switch (edit["kind"]) {
    case "extrude":
      return `extrude ${name ?? "a bone"} from ${bone} to ${point(edit["to"]) ?? "?"}`;
    case "subdivide":
      return `split ${bone} into ${String(edit["count"] ?? "?")}`;
    case "duplicate": {
      const replace = list(edit["replace"]).map((v) => text(v) ?? "");
      return `copy ${bone} and the bones below it${point(edit["offset"]) ? `, moved ${point(edit["offset"])}` : ""}${replace.length === 2 ? `, “${replace[0]}” renamed “${replace[1]}”` : ""}`;
    }
    case "rename":
      return `rename ${bone} to ${name ?? "?"}`;
    case "remove":
      return `remove ${bone}`;
    default:
      return `${String(edit["kind"] ?? "?")} ${bone}`;
  }
}

export function rigBoneRows(args: Args): Row[] {
  const ready = record(args["from"]);
  const bones = list(args["bones"]);
  const edits = list(args["bone_edits"]);
  const collections = list(args["collections"]).map((c) => {
    const found = record(c);
    const count = list(found["bones"]).length;
    return `${text(found["name"]) ?? "?"}${count ? ` (${plural(count, "bone")})` : ""}${found["visible"] === false ? ", hidden" : ""}`;
  });
  const facing = text(ready["facing"]) ?? "-y";
  return [
    ...row(
      "Ready rig",
      args["from"] === undefined
        ? undefined
        : `Rigify's ${text(ready["kind"]) ?? "?"} fitted to ${text(ready["fit_to"]) ?? "?"}, its front toward ${facing}, and its rig generated`,
    ),
    ...row(
      "Armature",
      text(args["armature"]) ??
        (args["from"] !== undefined && text(ready["fit_to"])
          ? `${text(ready["fit_to"])} rig`
          : undefined),
    ),
    ...row(
      "Bones",
      bones.length
        ? `${plural(bones.length, "bone")}: ${bones.slice(0, 8).map(boneWords).join("; ")}${bones.length > 8 ? "; …" : ""}`
        : undefined,
    ),
    ...row("Edits", edits.length ? edits.map(editWords).join("; ") : undefined),
    ...row(
      "Mirror",
      args["symmetrize"] === "L" || args["symmetrize"] === "R"
        ? `the ${args["symmetrize"] === "L" ? "left (.L)" : "right (.R)"} bones onto the other side`
        : undefined,
    ),
    ...row("Collections", collections.length ? names(collections) : undefined),
  ];
}
