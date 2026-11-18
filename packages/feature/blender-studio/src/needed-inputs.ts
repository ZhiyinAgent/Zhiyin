/**
 * The inputs a change cannot be made without that its tool's schema cannot
 * say, checked before anyone is asked about it. Whatever the schema requires
 * is checked against it before this, as every connection's calls are; what is
 * left is what one input needs of another: a shaping step's size or count by
 * its kind, and the choices where exactly one of two is given. Blender refuses
 * each of these too; checked here, an approval never shows a change with a
 * part left blank, and the model hears what to add before a person spends
 * attention on a call that cannot run.
 *
 * Only presence is checked. Ranges, and whether a named object exists, stay
 * Blender's to judge.
 */

type Args = Record<string, unknown>;

const record = (value: unknown): Args =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Args)
    : {};
const items = (value: unknown): Args[] =>
  Array.isArray(value) ? value.map(record) : [];
const given = (value: unknown) => value !== undefined;

/** What each kind of shaping step needs, besides its kind. */
const stepNeeds: Readonly<Record<string, readonly string[]>> = {
  bevel: ["width"],
  hard_surface: ["width"],
  solidify: ["thickness"],
  shrinkwrap: ["target"],
  remove: ["modifier"],
};

/** What else a shaping step needs, by what it is given. */
function stepAlsoNeeds(step: Args): string[] {
  const needs: string[] = [];
  switch (step["kind"]) {
    case "array": {
      // As many as fill a length or a curve, or a count of them.
      if (step["fit"] === "length") needs.push("length");
      else if (step["fit"] === "curve") needs.push("curve");
      else needs.push("count");
      // A step apart, a multiple of its size, an object's offset, an axis or a curve to follow.
      const spaced = ["offset", "relative", "offset_object", "around", "curve"];
      if (!spaced.some((key) => given(step[key]))) needs.push("offset");
      break;
    }
    case "remesh":
      if (step["method"] !== "quadriflow") needs.push("voxel_size");
      break;
    case "displace":
      if (step["texture"] === "image") needs.push("image");
      break;
  }
  return needs.filter((key) => !given(step[key]));
}

/** The inputs a call leaves out, and the pairs it must give exactly one of. */
type Faults = { missing: string[]; oneOf: [string, string][] };

function faultsIn(command: string, args: Args): Faults {
  const faults: Faults = { missing: [], oneOf: [] };
  const need = (ok: boolean, path: string) => {
    if (!ok) faults.missing.push(path);
  };
  switch (command) {
    case "shape":
      items(args["operations"]).forEach((step, i) => {
        const kind = String(step["kind"]);
        // A cut names the object or collection it cuts with, or describes its cutter.
        if (
          kind === "boolean" &&
          !given(step["cutter"]) &&
          !given(step["collection"])
        )
          need(given(step["with"]), `operations[${i}].with`);
        for (const key of stepNeeds[kind] ?? [])
          need(given(step[key]), `operations[${i}].${key}`);
        for (const key of stepAlsoNeeds(step))
          faults.missing.push(`operations[${i}].${key}`);
      });
      break;
    case "camera": {
      const dof = args["depth_of_field"];
      if (dof === undefined || record(dof)["off"]) break;
      const { focus_object, focus_distance } = record(dof);
      // It focuses on an object or at a distance: exactly one of them.
      need(
        given(focus_object) || given(focus_distance),
        "depth_of_field.focus_object",
      );
      if (given(focus_object) && given(focus_distance))
        faults.oneOf.push([
          "depth_of_field.focus_object",
          "depth_of_field.focus_distance",
        ]);
      break;
    }
    case "edit":
      items(args["edits"]).forEach((edit, i) => {
        const copies = record(edit["duplicate"]);
        // Copies go a step apart or round an axis: exactly one of them.
        if (
          given(edit["duplicate"]) &&
          given(copies["offset"]) === given(copies["around"])
        )
          faults.oneOf.push([
            `edits[${i}].duplicate.offset`,
            `edits[${i}].duplicate.around`,
          ]);
        const turn = record(edit["turn_about"]);
        // A turn goes round a point or an object: exactly one of them.
        if (
          given(edit["turn_about"]) &&
          given(turn["point"]) === given(turn["object"])
        )
          faults.oneOf.push([
            `edits[${i}].turn_about.point`,
            `edits[${i}].turn_about.object`,
          ]);
      });
      break;
    case "material": {
      const material = record(args["material"]);
      const maps = record(material["maps"]);
      // A texture set is a folder of pictures or pictures named one by one.
      const pictures = [
        "folder",
        "color",
        "roughness",
        "metallic",
        "normal",
        "height",
        "ao",
        "opacity",
        "orm",
      ];
      if (given(material["maps"]))
        need(
          pictures.some((key) => given(maps[key])),
          "material.maps.folder",
        );
      const height = record(material["height"]);
      // Relief comes from a picture or a pattern, not both. Given neither, it
      // comes from the texture set the material holds, which Blender knows.
      if (given(height["path"]) && given(height["pattern"]))
        faults.oneOf.push(["material.height.path", "material.height.pattern"]);
      break;
    }
    case "animate":
      items(args["belts"]).forEach((belt, i) => {
        // It runs at a speed or with a pulley it follows: exactly one of them.
        if (given(belt["speed"]) === given(belt["follows"]))
          faults.oneOf.push([`belts[${i}].speed`, `belts[${i}].follows`]);
      });
      items(args["paths"]).forEach((path, i) => {
        // It goes through points or along a curve: exactly one of them.
        if (given(path["points"]) === given(path["curve"]))
          faults.oneOf.push([`paths[${i}].points`, `paths[${i}].curve`]);
      });
      break;
    case "decal":
      if (args["kind"] === "strip") {
        // A strip runs along a line at a width; a picture pattern needs its picture.
        need(given(args["along"]), "along");
        need(given(args["width"]), "width");
        if (args["pattern"] === "picture")
          need(given(args["picture"]), "picture");
        if (args["pattern"] === "shape") need(given(args["shape"]), "shape");
        break;
      }
      need(given(args["at"]), "at");
      need(given(args["size"]), "size");
      if (args["kind"] === "normal") {
        // It draws one of Zhiyin's shapes or a picture's brightness, which stands as high as relief says.
        if (given(args["shape"]) === given(args["picture"]))
          faults.oneOf.push(["shape", "picture"]);
        if (given(args["picture"])) need(given(args["relief"]), "relief");
        break;
      }
      // It shows a picture or text: exactly one of them.
      if (given(args["picture"]) === given(args["text"]))
        faults.oneOf.push(["picture", "text"]);
      // Each channel it affects besides colour takes the value it is changed to.
      for (const [channel, value] of [
        ["roughness", "roughness"],
        ["metal", "metal"],
        ["coat", "coat"],
        ["normal", "relief"],
      ] as const)
        if (Array.isArray(args["affects"]) && args["affects"].includes(channel))
          need(given(args[value]), value);
      break;
    case "rig":
      items(args["ik"]).forEach((reach, i) => {
        // A chain reaches for a target or lies along a curve: exactly one of them.
        if (given(reach["target"]) === given(reach["curve"]))
          faults.oneOf.push([`ik[${i}].target`, `ik[${i}].curve`]);
      });
      // Bones go in an armature the call names, unless a ready rig makes it.
      if (
        ["bones", "bone_edits", "symmetrize", "collections"].some((key) =>
          given(args[key]),
        ) &&
        !given(args["from"])
      )
        need(given(args["armature"]), "armature");
      items(args["bone_edits"]).forEach((edit, i) => {
        // An extrusion reaches a point, a split makes a count, a rename takes a name.
        const needs = { extrude: "to", subdivide: "count", rename: "name" };
        const key = needs[String(edit["kind"]) as keyof typeof needs];
        if (key) need(given(edit[key]), `bone_edits[${i}].${key}`);
      });
      break;
    case "scatter":
      // So many copies, or so many per square metre: exactly one of them.
      if (given(args["count"]) === given(args["density"]))
        faults.oneOf.push(["count", "density"]);
      break;
    case "simulate":
      items(args["rigid"]).forEach((body, i) => {
        // An active body is weighed by exactly one of a density, a material and a mass.
        if ((body["role"] ?? "active") !== "active") return;
        const weighed = ["density", "material", "mass"].filter((key) =>
          given(body[key]),
        );
        if (weighed.length === 0) faults.missing.push(`rigid[${i}].density`);
        for (let j = 1; j < weighed.length; j++)
          faults.oneOf.push([
            `rigid[${i}].${weighed[0]}`,
            `rigid[${i}].${weighed[j]}`,
          ]);
      });
      break;
    case "measure":
      // A clearance is from one object, centres between two; a gap is between
      // two, or from one along an axis.
      if (args["kind"] === "clearance") need(given(args["from"]), "from");
      else if (args["kind"] === "centres" || args["kind"] === "deviation")
        need(given(args["between"]), "between");
      else if (given(args["between"]) === given(args["from"]))
        faults.oneOf.push(["between", "from"]);
      else if (given(args["from"])) need(given(args["along"]), "along");
      break;
  }
  return faults;
}

const inWords = (paths: readonly string[]) =>
  paths.length === 1
    ? paths[0]
    : `${paths.slice(0, -1).join(", ")} and ${paths.at(-1)}`;

/** A refusal naming what a change is missing, or nothing when it has all it needs. */
export function missingInputs(command: string, args: Args) {
  const { missing, oneOf } = faultsIn(command, args);
  if (missing.length === 0 && oneOf.length === 0) return undefined;
  const said = [
    ...(missing.length ? [`This call is missing ${inWords(missing)}.`] : []),
    ...oneOf.map(([one, other]) => `Give exactly one of ${one} and ${other}.`),
  ];
  return { reason: said.join(" "), correctable: true };
}
