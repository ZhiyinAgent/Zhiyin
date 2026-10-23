/**
 * The tools the model is offered, with their schemas. Sizes and positions are
 * in metres and angles in degrees, as people give them. An object's location
 * is its origin, as in Blender, and the rule is stated where the model reads
 * it: in the tools' own descriptions.
 *
 * Every input has one type. A model whose provider turns its written-out call
 * back into arguments reads each value by its declared type, and an input that
 * may be either a name or a point arrived cut off at that value.
 */

export type StudioTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
};

const vector3 = (description: string) => ({
  type: "array",
  items: { type: "number" },
  minItems: 3,
  maxItems: 3,
  description,
});
const point2 = {
  type: "array",
  items: { type: "number" },
  minItems: 2,
  maxItems: 2,
};
const colour = (description: string) => ({
  type: "string",
  pattern: "^#?[0-9a-fA-F]{6}$",
  description,
});
const workspaceFile = (description: string) => ({
  type: "string",
  description,
});
const objectNames = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  description: "Names of objects in the scene.",
};

const objectSpec = {
  type: "object",
  properties: {
    name: { type: "string", description: "A new, unique name." },
    kind: {
      type: "string",
      enum: [
        "cube",
        "cylinder",
        "cone",
        "sphere",
        "plane",
        "torus",
        "revolve",
        "outline",
        "tube",
        "text",
        "image",
        "svg",
        "model",
      ],
      description:
        "cube, cylinder, cone, sphere: a solid of the given size (a cylinder's is [diameter, diameter, height]). plane: flat, size [x, y]. torus: a ring. revolve: a profile turned around the vertical axis (bottles, cups, cans); a profile that comes back down the inside gives it walls. outline: a flat outline, with holes, extruded to a height (walls from a floor plan, plates). tube: a round tube along points (pipes, cables). text: 3D lettering, a shape like any other, flat unless wrap_radius bends it round a jar or a bottle. image: a workspace picture on a plane. svg: a workspace SVG drawing, extruded into shapes. model: a workspace model file.",
    },
    size: {
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 3,
      description:
        "Width, depth, height in metres, along the object's own axes before it is turned. For a model, the box it is scaled to fit.",
    },
    location: vector3(
      "Where the object's origin goes, in metres. Defaults to [0, 0, 0].",
    ),
    rest_on: {
      type: "string",
      description:
        "“floor”, or an object to set this one down on, as if lowered straight onto it: it lands on the first surface below, such as a saucer's well. Its location gives where across.",
    },
    rotation: vector3("Rotation around x, y and z, in degrees."),
    parent: { type: "string", description: "An object this one moves with." },
    smooth: {
      type: "boolean",
      description:
        "Smooth shading that keeps sharp edges crisp. On by default for round shapes (cylinder, cone, sphere, torus, revolve, tube); false gives flat faces.",
    },
    bevel: {
      type: "object",
      properties: { width: { type: "number" }, segments: { type: "integer" } },
      required: ["width"],
      description:
        "Rounded edges: width in metres, at most half the object's thinnest side; segments for smoothness.",
    },
    segments: {
      type: "integer",
      description:
        "cylinder, cone, sphere, torus, revolve: sides around, for smoothness. Default 64. A tube takes none.",
    },
    top_ratio: {
      type: "number",
      description:
        "cone: the top diameter as a share of the bottom one, 0 to 1.",
    },
    diameter: {
      type: "number",
      description: "torus: outer diameter in metres.",
    },
    thickness: {
      type: "number",
      description: "torus: thickness of the ring in metres.",
    },
    profile: {
      type: "array",
      items: point2,
      description:
        "revolve: [radius, height] points in metres, in order along the shape's cross-section. Starting and ending on the axis (radius 0) closes it; running up the outside and back down the inside makes a vessel whose walls are as thick as the gap between the two. A profile that touches the axis at neither end is the cross-section of a ring, a sleeve or a band: its last point is joined back to its first, so four corners make a solid band.",
    },
    points: {
      type: "array",
      items: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 3,
      },
      description:
        "outline: [x, y] corners in metres. tube: [x, y, z] points in metres.",
    },
    holes: {
      type: "array",
      items: { type: "array", items: point2 },
      description: "outline: inner outlines cut out of it.",
    },
    height: {
      type: "number",
      description: "outline: extrusion height. text: letter height. In metres.",
    },
    radius: { type: "number", description: "tube: radius in metres." },
    corners: {
      type: "string",
      enum: ["round", "sharp"],
      description:
        "tube: round (default) is a smooth curve through every point, for handles and cables; sharp joins the points with straight runs, for pipes.",
    },
    closed: {
      type: "boolean",
      description:
        "tube: join the last point back to the first. revolve: whether the profile's last point is joined back to its first; true by default for a profile of three points or more that touches the axis at neither end, and false leaves it a sheet with no thickness. A profile with both ends on the axis is closed by the axis either way.",
    },
    text: {
      type: "string",
      description:
        "text: the words. Chinese, Japanese and Korean get a font that has them.",
    },
    depth: { type: "number", description: "text, svg: thickness in metres." },
    wrap_radius: {
      type: "number",
      description:
        "text: bends the line round a round surface of this radius in metres, as lettering lies on a jar, a can or a bottle: its back on the surface, its ends curving back with it, as long along the surface as it was flat. The axis it bends round runs up the letters, that far behind the text's middle: for a jar standing at the origin, give the jar's radius, rotation [90, 0, 0] and a location on its front, [0, -radius, height]. Flat text in front of a round surface touches it only at its middle and stands off at its ends.",
    },
    font: workspaceFile(
      "text: a .ttf, .otf or .ttc font in the workspace, or a font file name from Windows' Fonts folder.",
    ),
    width: {
      type: "number",
      description:
        "image, svg: width in metres; the height follows its proportions.",
    },
    path: workspaceFile("image, svg, model: the workspace file to use."),
  },
  required: ["name", "kind"],
  additionalProperties: false,
};

const pictureMap = {
  type: "object",
  properties: {
    path: workspaceFile("A picture in the workspace."),
    projection: {
      type: "string",
      enum: ["uv", "box", "cylinder", "sphere", "front"],
      description:
        "How the picture wraps: cylinder around a can or bottle, box on all sides, front from the front, uv along the shape's own layout.",
    },
    repeat: {
      ...point2,
      description: "How many times it repeats across and up.",
    },
    use_alpha: {
      type: "boolean",
      description: "Use the picture's transparency.",
    },
    strength: {
      type: "number",
      description: "normal_map: how strong the surface detail is.",
    },
  },
  required: ["path"],
  additionalProperties: false,
};

export const studioTools: readonly StudioTool[] = [
  {
    name: "blender_open_scene",
    description:
      "Open a Blender scene file in the workspace, or create a new empty one. Every other Blender tool works on the scene opened here, and the scene file is saved after every change. The person watches each change in the 3D view.",
    inputSchema: {
      type: "object",
      properties: {
        path: workspaceFile("Workspace-relative path of a .blend file."),
        create: {
          type: "boolean",
          description:
            "Create a new empty scene when the file does not exist. Never replaces an existing file.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_add_objects",
    description:
      "Add objects to the open scene: solids, rings, turned profiles, extruded outlines with holes, tubes, 3D text, pictures on planes, SVG drawings or model files. Geometry is built at its real size in metres, with z up: the front looks from -y toward +y, and +x is to the right. An object's location is where its origin goes. Solids, rings, text, pictures, drawings and model files are centred on their origin. A shape drawn through points keeps the coordinates it was drawn in, around its origin: a revolve's profile heights, an outline rising from the origin's height, a tube through its points. Planes, text, pictures and drawings lie flat, facing up; rotation [90, 0, 0] stands one up facing the front. An input a kind does not take is refused. The answer gives each object's own size, its turn, where its bottom and top are, and what it goes into.",
    inputSchema: {
      type: "object",
      properties: {
        objects: { type: "array", items: objectSpec, minItems: 1 },
      },
      required: ["objects"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_edit_objects",
    description:
      "Move, turn, resize, rename, attach, hide, duplicate, set down on the floor or on another object, or delete objects. Positions and turns are the world's, for attached parts too, and turning and resizing happen around the object's origin; a size is the object's own, along its own axes. Copying, hiding or deleting an object does the same to what is attached to it, holes included. The answer says where each moved object's bottom and top are, and what it goes into.",
    inputSchema: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              object: { type: "string" },
              location: vector3("Where the origin goes, in metres."),
              move_by: vector3("Move by this much, in metres."),
              rotation: vector3("New rotation in degrees."),
              size: vector3("New size in metres."),
              scale: vector3("Scale factors on its built size; 1 is as built."),
              rename: { type: "string" },
              parent: {
                type: "string",
                description: "An object this one moves with from now on.",
              },
              detach: {
                type: "boolean",
                description: "Stop moving with the object it is attached to.",
              },
              hidden: { type: "boolean" },
              rest_on: {
                type: "string",
                description:
                  "“floor”, or an object to set this one down on, as if lowered straight onto it: it lands on the first surface below.",
              },
              duplicate: {
                type: "object",
                properties: {
                  count: { type: "integer" },
                  offset: vector3("Step between copies, in metres."),
                },
                required: ["offset"],
              },
              delete: { type: "boolean" },
            },
            required: ["object"],
            additionalProperties: false,
          },
        },
      },
      required: ["edits"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_shape_objects",
    description:
      "Model a mesh object: cut holes or shapes out of it, join or intersect it with others, round its edges, repeat, mirror, give it wall thickness, smooth or subdivide it. Each step stays editable unless applied. To make a hole, use a boolean difference with a cutter described in the call, or with an object already in the scene, which is then hidden. A mirror keeps the side of the mirror the object mostly lies on and cuts away what reaches across, so it never overlaps itself. The answer gives the object's size and heights afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        object: { type: "string" },
        operations: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: [
                  "boolean",
                  "bevel",
                  "array",
                  "mirror",
                  "solidify",
                  "subdivision",
                  "smooth",
                  "remove",
                ],
              },
              operation: {
                type: "string",
                enum: ["difference", "union", "intersect"],
                description: "boolean: what to do with the other shape.",
              },
              with: {
                type: "string",
                description:
                  "boolean: another object to combine with; it is hidden afterwards unless keep_visible.",
              },
              keep_visible: { type: "boolean" },
              cutter: {
                type: "object",
                description:
                  "boolean: a cutting shape made for this call, kept as its own object so it can be moved later.",
                properties: {
                  shape: {
                    type: "string",
                    enum: ["cylinder", "box", "sphere"],
                  },
                  diameter: {
                    type: "number",
                    description: "cylinder or sphere: in metres.",
                  },
                  depth: {
                    type: "number",
                    description: "cylinder: in metres.",
                  },
                  size: vector3("Size in metres; a box needs one."),
                  location: vector3("Centre of the cutter, in metres."),
                  rotation: vector3(
                    "Rotation in degrees; a cylinder points along z.",
                  ),
                },
                required: ["location"],
              },
              width: {
                type: "number",
                description:
                  "bevel: in metres, at most half the thinnest side.",
              },
              segments: { type: "integer", description: "bevel: smoothness." },
              angle: {
                type: "number",
                description:
                  "bevel, smooth: edges sharper than this many degrees.",
              },
              count: {
                type: "integer",
                description: "array: number of copies.",
              },
              offset: vector3("array: step between copies, in metres."),
              axes: {
                type: "array",
                items: { type: "string", enum: ["x", "y", "z"] },
                description: "mirror: axes to mirror across.",
              },
              across: {
                type: "string",
                description: "mirror: an object to mirror around.",
              },
              thickness: {
                type: "number",
                description:
                  "solidify: walls this thick, in metres, grown inward so the outside keeps its size. A closed shape becomes hollow and sealed; an open one, such as a cup, gets walls.",
              },
              levels: { type: "integer", description: "subdivision: 1 to 5." },
              modifier: {
                type: "string",
                description: "remove: the name of a step to remove.",
              },
            },
            required: ["kind"],
            additionalProperties: false,
          },
        },
        apply: {
          type: "boolean",
          description:
            "Bake every step into the mesh. Cutters nothing else uses are removed.",
        },
      },
      required: ["object", "operations"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_set_material",
    description:
      "Give objects a material: colour, metal, wood, roughness, clear coat, glass, glow, transparency, a picture wrapped round them, or surface detail from a normal map. Each call sets the whole material: anything left out goes back to its default, so give every value to keep; naming an existing material with nothing else puts it on as it is. blender_describe_scene lists each material's values.",
    inputSchema: {
      type: "object",
      properties: {
        objects: objectNames,
        material: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Reuses the material of that name, or makes one.",
            },
            color: colour("Base colour, like #c0392b."),
            metallic: { type: "number", description: "0 to 1." },
            wood: {
              type: "number",
              description:
                "Wood grain, 0 to 1, drawn in the colour given, which is the wood's own: #c9a678 for oak, #e3cfa8 for birch or pine, #6b4a32 for walnut. Streaks run along each object's longest side, a few centimetres wide whatever its size, and every board has its own: 0.5 is a calm grain, 1 a bold one. Not with a texture.",
            },
            roughness: {
              type: "number",
              description: "0 (mirror) to 1 (matte).",
            },
            transmission: {
              type: "number",
              description:
                "How much light passes through, 0 to 1: 1 for glass, clear plastic and liquids. The colour filters the light that comes through, once however thick the object is, so a coloured liquid or tinted glass lit from behind looks lighter than its colour. A flat sheet of glass far thinner than it is wide, such as a window pane, lets the sun and the lamps through as real glass does and casts no shadow; other glass shades what is behind it.",
            },
            ior: {
              type: "number",
              description: "Index of refraction: 1.45 glass, 1.33 water.",
            },
            alpha: {
              type: "number",
              description:
                "Opacity, 0 to 1, for cut-outs and thin see-through films; glass and liquids use transmission.",
            },
            emission: {
              type: "object",
              properties: {
                color: colour(
                  "Glow colour. Left out on a material with a texture, the picture is what glows, as on a screen.",
                ),
                strength: { type: "number" },
              },
            },
            specular: {
              type: "number",
              description:
                "How strongly a non-metal reflects, 0 to 1. 0.5 (default) is what its ior gives; lower reflects less, 0 not at all.",
            },
            coat: {
              type: "number",
              description:
                "A clear glossy layer on top, 0 to 1, as on glazed ceramic or lacquer.",
            },
            coat_roughness: {
              type: "number",
              description:
                "How blurred the coat's reflections are, 0 to 1. Default 0.03, glassy.",
            },
            texture: {
              ...pictureMap,
              description: "A picture as the base colour, such as a label.",
            },
            normal_map: {
              ...pictureMap,
              description: "A normal map for surface detail.",
            },
          },
          additionalProperties: false,
        },
      },
      required: ["objects", "material"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_set_camera",
    description:
      "Set the scene's camera: frame objects from any side, centred in the picture, or place it and aim it at a point or at an object's middle; lens or orthographic, lens shift, depth of field, picture size, exposure and tone. The answer says which objects the picture shows whole, cuts off, has hidden behind others or misses, and when the camera is inside a shape.",
    inputSchema: {
      type: "object",
      properties: {
        frame: {
          type: "object",
          properties: {
            objects: {
              type: "array",
              items: { type: "string" },
              description: "What to fit in the picture; everything by default.",
            },
            direction: {
              type: "string",
              enum: ["front", "back", "left", "right", "three-quarter", "top"],
              description:
                "top looks straight down with +y up the picture and +x to the right, as a plan reads with north up.",
            },
            margin: {
              type: "number",
              description:
                "Space around, as a share of the picture, 0 to 0.9. Default 0.1.",
            },
            around: {
              type: "number",
              description:
                "Degrees to move round the objects from the direction, anticlockwise seen from above, added to the direction's own: from the front, 45 is the three-quarter and 90 the right; from the three-quarter, 45 is the right. From the top it turns the picture: 180 puts -y up. The answer says where the camera lands.",
            },
            elevation: {
              type: "number",
              description:
                "Degrees above level to look from, keeping the direction's side: 0 is eye level, 90 straight down. Each direction has its own by default.",
            },
          },
        },
        orthographic: {
          type: "boolean",
          description:
            "true for a picture without perspective, as a plan or an elevation drawing, sized to what is framed; false for perspective again.",
        },
        location: vector3("Camera position in metres, when not framing."),
        look_at: vector3("A point to aim at, in metres, when not framing."),
        look_at_object: {
          type: "string",
          description: "An object to aim at the middle of, when not framing.",
        },
        lens: {
          type: "number",
          description:
            "Focal length in mm. 50 is natural, 85 to 100 flatters products.",
        },
        shift: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          maxItems: 2,
          description:
            "Lens shift, [across, up]: slides what the camera sees without turning the camera, in picture widths (its longer side), so upright things stay upright. [0, 0.1] sees a tenth of a width higher, and everything sits that much lower in the picture. For matching a photo taken with a level camera whose eye level is not at mid-height. It stays until set again, [0, 0] removes it, and framing still centres what it frames.",
        },
        depth_of_field: {
          type: "object",
          properties: {
            focus_object: {
              type: "string",
              description:
                "An object to keep in focus, at its middle, wherever it or the camera moves.",
            },
            focus_distance: {
              type: "number",
              description: "Or a distance to focus at, in metres.",
            },
            aperture: {
              type: "number",
              description: "f-stop; lower blurs more. Default 2.8.",
            },
            off: {
              type: "boolean",
              description: "Turn the background blur off.",
            },
          },
          additionalProperties: false,
        },
        resolution: {
          ...point2,
          description: "Picture size in pixels, width and height.",
        },
        exposure: {
          type: "number",
          description:
            "Brightens (above 0) or darkens (below 0) the whole picture, background included, in stops: +1 doubles the light. 0 by default, which keeps the product backdrop white.",
        },
        tone: {
          type: "string",
          enum: ["agx", "neutral", "standard"],
          description:
            "How light becomes colours: agx (Blender's default) keeps bright light from clipping but lightens deep colours and greys whites; neutral shows colours as given under white light, softening only the brightest parts; standard shows them as given and clips above white.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "blender_set_lighting",
    description:
      "Light the scene: a preset (studio, product with a seamless white backdrop all around, daylight), a background colour, a picture of surroundings (HDRI), a sky with the sun, or individual lights. A light named like one in the scene changes only what is given, and a moved light stays aimed where it was. Each part can be sent alone.",
    inputSchema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["studio", "product", "daylight", "none"],
          description:
            "Replaces what a preset made before; the model's own lights stay. product also sets the neutral tone, the others agx.",
        },
        background: {
          type: "object",
          properties: {
            color: colour("A plain background."),
            hdri: workspaceFile(
              "A .hdr or .exr picture of surroundings in the workspace.",
            ),
            rotation: {
              type: "number",
              description: "hdri: turn it, in degrees.",
            },
            sky: {
              type: "object",
              properties: {
                sun_elevation: {
                  type: "number",
                  description:
                    "Degrees above the horizon, -10 to 90. Default 35.",
                },
                sun_rotation: {
                  type: "number",
                  description:
                    "The side the sun stands on, as a compass bearing in degrees with +y as north: 0 is +y, 90 is +x, 180 is -y, 270 is -x. Its light travels the opposite way, so 270 shines in through a window in a wall on the -x side. Default 0.",
                },
              },
              description:
                "A sky over level ground that reaches the horizon, with the sun in it. The answer says which side the sun stands on and which way its light travels.",
            },
            strength: { type: "number" },
          },
        },
        lights: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              kind: { type: "string", enum: ["area", "point", "spot", "sun"] },
              location: vector3("In metres."),
              look_at: vector3(
                "A point to aim at, in metres. Default [0, 0, 0].",
              ),
              look_at_object: {
                type: "string",
                description: "Or an object to aim at the middle of.",
              },
              power: {
                type: "number",
                description: "Watts, for area, point and spot lights.",
              },
              strength: { type: "number", description: "For the sun." },
              color: colour("Light colour."),
              size: {
                type: "number",
                description: "area: size in metres; larger is softer.",
              },
              spot_angle: {
                type: "number",
                description: "spot: cone angle in degrees.",
              },
            },
            additionalProperties: false,
          },
        },
        replace: {
          type: "boolean",
          description: "Remove every light made before; a backdrop stays.",
        },
        backdrop_reflections: {
          type: "number",
          description:
            "How bright the product backdrop looks in reflections, 0 to 1 of how bright it looks in the picture. 0.25 (default) is as bright as a white surface beside the product, so glossy colours stay as given: keep it for anything coloured or white, glossy or not, such as glaze, paint, plastic or porcelain. Higher, a glossy colour turns pale, with a hard line where it reflects something beside it, such as a saucer, instead of the backdrop. Raise it toward 1 only for chrome and glass, which show their shape by what they reflect. The picture's background stays as it is.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "blender_render",
    description:
      "Render a still picture to the workspace: through the scene's camera, with Cycles (best, uses the GPU when there is one) or EEVEE (fast, for layout and framing; it shows less of what surroundings light and reflect, and sees through one layer of glass at most, so judge colours, brightness, glass and liquids in Cycles); or, with view plan, the plan of the whole scene from straight above, in one call that leaves the scene as it was. Stills only, no animation. The picture opens beside the conversation, and the answer gives the tone and exposure it was made with, the colour each object shows in it and the background's, and, for Cycles, which surfaces are lit past their own colours with the exposure that shows them as they are. With glass or a liquid in the scene, Cycles follows light through enough bounces that thick glass shows no dark bands.",
    inputSchema: {
      type: "object",
      properties: {
        output: workspaceFile("Workspace-relative .png or .jpg path."),
        engine: {
          type: "string",
          enum: ["cycles", "eevee"],
          description:
            "For a picture through the camera; cycles by default. A plan is always drawn with EEVEE: leave engine out.",
        },
        samples: {
          type: "integer",
          description:
            "More is cleaner and slower. Cycles 128, EEVEE 64 by default.",
        },
        resolution: {
          ...point2,
          description:
            "Width and height in pixels. Through the camera it becomes the scene's picture size; for a plan it is this picture's only.",
        },
        view: {
          type: "string",
          enum: ["camera", "plan"],
          description:
            "camera (default): through the scene's camera. plan: the whole scene from straight above, orthographic, with +y up the picture as a plan has north, under an even white light that walls do not shade, so floors and furniture show close to the colours they were given however high the walls are. It is cut as a drawn plan is, 1.2 m above the floor unless cut says where: what stands above, such as a ceiling or a roof, is not drawn, and what the cut passes through is filled where it is cut: dark for what is as high as the highest of them, as walls are, and in its own colour for what is lower, as a door's leaf, a window or a wardrobe is. A door shows as a gap in its wall and a window as the lighter top of the wall under it. The plan has its own camera, light, neutral tone and exposure: the scene's camera, lights, background, tone, exposure and picture size stay as they were, so nothing is hidden, changed or put back by hand.",
        },
        cut: {
          type: "number",
          description:
            "For a plan: the height it is cut at, in metres up the z axis. By default 1.2, for a floor at z = 0; in a scene that stands wholly above or below z = 0, 1.2 m above its lowest point. Leave it out for a plan a person will read: cut above the heads of the doors and windows, every one of them closes up and the walls read as unbroken. A height above everything cuts nothing and shows the scene's top.",
        },
        without: {
          type: "array",
          items: { type: "string" },
          description:
            "Objects left out of this picture only, with what is attached to them: a wall in the way of a view from outside, or something a plan should not show. The scene keeps them.",
        },
        background: {
          type: "string",
          enum: ["scene", "white", "transparent"],
          description:
            "What surrounds the product. scene (default): what the scene shows, such as the product backdrop, white under the product and light grey higher up. white: exact white (#ffffff) with the product's own shadow, as marketplaces ask of a main picture; Cycles only. transparent: nothing, .png only, for a shop that places products on its own background. With white or transparent the backdrop still lights the product and shows in its reflections.",
        },
        camera: {
          type: "string",
          description: "Render through this camera instead.",
        },
      },
      required: ["output"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_export",
    description:
      "Export objects to one model file in the workspace: .glb for the web, with materials and pictures inside; .stl for 3D printing (in millimetres); .obj (shapes only), .fbx, .usd or .ply. Editable steps such as holes are applied in the file, and named objects are exported even when hidden.",
    inputSchema: {
      type: "object",
      properties: {
        output: workspaceFile(
          "Workspace-relative path; the extension picks the format.",
        ),
        objects: {
          type: "array",
          items: { type: "string" },
          description: "What to export; every visible object by default.",
        },
      },
      required: ["output"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_describe_scene",
    description:
      "Describe the open scene: each object's size, origin, bottom and top heights, what it goes into, its materials with their values and its editing steps with theirs, whether its mesh is closed and its volume; see-through shapes whose surfaces are in the same place, which a picture shows as wedges; the camera and what its picture shows; the lights with their size and aim; the render settings, tone and exposure. Also shows the latest preview picture to a model that can see pictures.",
    inputSchema: {
      type: "object",
      properties: {
        objects: {
          type: "array",
          items: { type: "string" },
          description: "Only these objects.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "blender_api",
    description:
      "Ask the installed Blender what its Python API accepts: a type's properties and allowed values, a node's inputs, or an operator's parameters. Use before writing a script. Examples: Object, ShaderNodeBsdfPrincipled, Principled BSDF, bpy.ops.mesh.bevel.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "blender_run_script",
    description:
      "Run Blender Python (bpy) in the open scene, for anything the other tools do not cover, such as geometry nodes or physics. It runs in the workspace folder, and a path without a drive letter means the workspace, wherever in it suits: for Python's own file functions, and for Blender's where a script gives the path as filepath, filepath_raw, directory or base_path, to bpy.data's loaders written out in full (bpy.data.images.load('renders/a.png')), or to save_render. So image.filepath_raw = 'textures/a.png' then image.save() writes textures/a.png in the workspace. Handed to Blender any other way, such as through setattr, such a path is taken from the root of the drive, where Blender may not write: give those the whole path, os.path.abspath('textures/a.png'). Of the person's files, Blender reads and writes only those inside the workspace, in any folder of it, and it has no internet: a file anywhere else is refused, so one kept elsewhere has to be copied in first. This Blender's numpy comes without numpy.random: Python's own random module is here. What it prints is returned, followed by what it added, moved or resized, and removed, said as the other tools say theirs: each object's size, where its bottom and top are and what it goes into (the deepest three), or past a dozen a count by name with how high they reach, which blender_describe_scene with objects then tells in full. A script that fails leaves the scene as it was saved.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python using bpy." },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
];
