/**
 * The tools that animate the open scene and show its motion: keys, paths and
 * aims; a frame sheet for the model, which cannot watch a video; and the
 * video for the person. Times are in seconds, as people give them.
 */

import {
  colour,
  point2,
  vector3,
  workspaceFile,
  type StudioTool,
} from "./schema-parts.js";
import {
  longestFormula,
  longestTimeline,
  longestVideoStated,
  mostFollowed,
} from "./motion-limits.js";
import { statedNumbers } from "./stated-numbers.js";
import { motionExtension, renderSampling } from "./look-schema.js";
import { driveSchema, posesSchema } from "./motion-drive-schema.js";
import { timeLimitStated } from "./time-limits.js";
import { toolkits } from "./toolkits.js";

/** One of an object's own values, which follow names. */
const followedValue = {
  type: "string",
  enum: ["place", "turn", "scale"],
  description:
    "Its place in metres or its turn in degrees, on what it is attached to as its keys are, or its scale.",
};
const followedAxis = {
  type: "string",
  enum: ["x", "y", "z"],
  description:
    "The value's axis: along it for a place or scale, about it for a turn.",
};

export const motionTools: readonly StudioTool[] = [
  {
    name: "blender_animate",
    toolkit: toolkits.motion.id,
    label: "Animate a 3D scene",
    checksWork: "runs",
    description: `Animate the open scene, at times in seconds. Keys set an object's place, turn, size, visibility, a camera's, light's or material's values, any property, or a bone's turn, place or IK reach, each eased from the key before; poses save a rig's pose by name, to key by name. A path moves an object, and a train behind it, through points or along a curve. Aim keeps an object pointed at another, turned about one axis only, stretched to reach it, or kept on a curve. Follow moves one of an object's values with another's at a ratio or by a formula, as a mechanism's parts do; drive sets any value from distances, turns or other values, live, without Python. Clear removes an object's motion; extend carries it on past its keys. Keys of an attached part are on what it is attached to, all others in the world's terms; a turn from 0 to 360 degrees is a whole turn. The timeline starts at 0 s and is lengthened to reach the last key; a new scene's ends at it. The answer measures each change: bone tips, driven values, lengths, speeds. Detail: doc:3d-rendering/animation. ${timeLimitStated("animate")}`,
    inputSchema: {
      type: "object",
      properties: {
        fps: {
          type: "integer",
          minimum: 1,
          maximum: 120,
          default: 24,
          description:
            "Frames a second. Keys stay at their times when it changes.",
        },
        duration: {
          type: "number",
          maximum: longestTimeline,
          description: `How long the timeline lasts, in seconds, at most ${longestTimeline}, the longest a timeline runs.`,
        },
        loop: {
          type: "boolean",
          description:
            "true for a motion meant to repeat, its last key its first pose again: the timeline ends a frame before that key.",
        },
        keys: {
          type: "array",
          description: "Values set at times, each eased from the key before.",
          items: {
            type: "object",
            properties: {
              object: {
                type: "string",
                description: "The object keyed, or the armature of bone.",
              },
              at: { type: "number", description: "The time, in seconds." },
              location: vector3("Where its origin is, in metres."),
              rotation: vector3("Its turn around x, y and z, in degrees."),
              size: vector3("Its own size in metres."),
              scale: vector3("Multiples of its built size."),
              hidden: {
                type: "boolean",
                description:
                  "Hidden or shown from this moment, with what is attached to it.",
              },
              lens: {
                type: "number",
                description: "A camera's focal length in mm.",
              },
              power: {
                type: "number",
                description: "A light's power: watts, or the sun's strength.",
              },
              color: colour(
                "A light's colour, or its material's base colour, shared by every object with it.",
              ),
              glow: {
                type: "number",
                description:
                  "Its material's glow, a multiple: 1 shows the glow colour as given.",
              },
              property: {
                type: "object",
                description:
                  'Any other animatable property, such as data.energy, modifiers["Array"].count or a custom ["open"].',
                properties: {
                  on: {
                    type: "string",
                    enum: ["object", "data", "material"],
                    description:
                      "The object's (default), its data's or its material's.",
                  },
                  path: {
                    type: "string",
                    description:
                      "Its path from that owner, as Blender writes it.",
                  },
                  values: {
                    type: "array",
                    items: { type: "number" },
                    minItems: 1,
                    description:
                      "In Blender's own units, metres and radians: one number, or one for each part of a colour or a vector.",
                  },
                },
                required: ["path", "values"],
                additionalProperties: false,
              },
              bone: {
                type: "string",
                description:
                  "A bone of the armature object: rotation turns it in degrees about its own axes from its rest, location moves it along them in metres, reach puts its IK target at a point in the world.",
              },
              reach: vector3(
                "For a bone: where its IK target goes in the world, in metres.",
              ),
              pose: {
                type: "string",
                description:
                  "A pose saved with poses, keyed on each of its bones.",
              },
              easing: {
                type: "string",
                enum: [
                  "smooth",
                  "linear",
                  "ease_in",
                  "ease_out",
                  "ease_in_out",
                  "constant",
                  "bounce",
                  "elastic",
                  "overshoot",
                ],
                description:
                  "How it is reached from the key before; smooth by default.",
              },
            },
            required: ["object", "at"],
            additionalProperties: false,
          },
        },
        paths: {
          type: "array",
          description: "Routes objects move along between two times.",
          items: {
            type: "object",
            properties: {
              object: { type: "string", description: "The object moved." },
              points: {
                type: "array",
                items: {
                  type: "array",
                  items: { type: "number" },
                  minItems: 3,
                  maxItems: 3,
                },
                minItems: 2,
                description:
                  "[x, y, z] metres it passes through, an attached part's on what it is attached to.",
              },
              curve: {
                type: "string",
                description: "Instead of points: a curve object to follow.",
              },
              bank: {
                type: "number",
                minimum: -80,
                maximum: 80,
                description:
                  "Degrees it leans into its hardest turn; needs facing.",
              },
              train: {
                type: "array",
                items: { type: "string" },
                description: "Objects following on its route, spacing apart.",
              },
              spacing: {
                type: "number",
                description: "Metres along the route.",
              },
              from: { type: "number", description: "Start time, in seconds." },
              to: { type: "number", description: "End time, in seconds." },
              easing: {
                type: "string",
                enum: ["linear", "ease_in", "ease_out", "ease_in_out"],
                description: "ease_in_out by default.",
              },
              facing: {
                type: "string",
                enum: ["x", "-x", "y", "-y", "z", "-z"],
                description:
                  "Its own axis pointed along the path, its top kept up; left out, it keeps its turn.",
              },
              closed: {
                type: "boolean",
                description: "Back to the first point, as a loop.",
              },
            },
            required: ["object", "from", "to"],
            additionalProperties: false,
          },
        },
        aim: {
          type: "array",
          description: "Objects kept pointed at another, or on a curve.",
          items: {
            type: "object",
            properties: {
              object: { type: "string", description: "The object aimed." },
              at: {
                type: "string",
                description:
                  "What it points at, a camera or light by its view; empty stops it, leaving it turned as it is.",
              },
              facing: {
                type: "string",
                enum: ["x", "-x", "y", "-y", "z", "-z"],
                description:
                  "Which of its own axes points at it, -y (its front) by default; a rod aims its length.",
              },
              up: {
                type: "string",
                enum: ["x", "y", "z"],
                description: "Its own axis kept up; z by default.",
              },
              locked: {
                type: "string",
                enum: ["x", "y", "z"],
                description:
                  "Turns about this own axis only, as a turret or a flap.",
              },
              stretch: {
                type: "boolean",
                description:
                  "Stretches along its y axis to reach it, keeping its thickness: a spring, a ram, a cable. Its origin is its fixed end.",
              },
              on_curve: {
                type: "boolean",
                description: "at is a curve it is kept on, instead of aimed.",
              },
            },
            required: ["object", "at"],
            additionalProperties: false,
          },
        },
        follow: {
          type: "array",
          items: {
            type: "object",
            properties: {
              object: { type: "string", description: "The part that follows." },
              value: followedValue,
              axis: followedAxis,
              from: {
                type: "object",
                description: "The value it follows.",
                properties: {
                  object: { type: "string", description: "The part followed." },
                  value: followedValue,
                  axis: followedAxis,
                },
                required: ["object", "value", "axis"],
                additionalProperties: false,
              },
              ratio: {
                type: "number",
                default: 1,
                description:
                  "A multiple: its value is the followed one times this; a gear of 20 teeth driven by one of 60 turns at 3, the other way at -3.",
              },
              offset: {
                type: "number",
                description: "Added after the ratio, in its own units.",
              },
              formula: {
                type: "string",
                maxLength: longestFormula,
                description: `Instead of ratio and offset: its value from v, the followed value, in metres, degrees or scale, by arithmetic the page lists; one too long to follow live is keyed at every frame. At most ${longestFormula} characters.`,
              },
            },
            required: ["object", "value", "axis", "from"],
            additionalProperties: false,
          },
          description:
            "Values that move with another's; a value that follows cannot be keyed. Clear the object to stop it.",
        },
        drive: driveSchema,
        poses: posesSchema,
        cad_motion: {
          type: "object",
          description:
            "Moves each part brought in from a CAD model as the CAD placed it, from cad_build's motion file, keyed at every frame, replacing its keys and follows of place, turn and size; an assembly sequence says the order parts go in.",
          properties: {
            file: {
              type: "string",
              description: "The motion file, a .json cad_build wrote.",
            },
            from: { type: "number", default: 0, description: "In seconds." },
            to: {
              type: "number",
              description:
                "In seconds; for a cycle, when it is back at the first.",
            },
            cycle: {
              type: "boolean",
              description:
                "The positions are one cycle, the first not repeated: it runs back to it at to, and on.",
            },
          },
          required: ["file", "to"],
          additionalProperties: false,
        },
        belts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              object: {
                type: "string",
                description: "The belt or chain, one object.",
              },
              pulleys: {
                type: "array",
                minItems: 2,
                items: {
                  type: "object",
                  properties: {
                    at: vector3(
                      "The pulley's or sprocket's centre, in metres.",
                    ),
                    radius: {
                      type: "number",
                      description:
                        "Where the belt's inner face rides, or a chain's pitch radius, in metres; negative for an idler on its back.",
                    },
                  },
                  required: ["at", "radius"],
                  additionalProperties: false,
                },
                description:
                  "In the order it runs round them, their centres in one plane.",
              },
              axis: vector3(
                "The direction of the pulleys' axis; needed for two pulleys.",
              ),
              speed: {
                type: "number",
                description:
                  "Metres a second, the way its pulleys are listed; negative the other way. It runs on past to.",
              },
              from: {
                type: "number",
                default: 0,
                description: "When it starts, in seconds.",
              },
              to: {
                type: "number",
                description:
                  "When its keys end, in seconds; the timeline's end by default.",
              },
              follows: {
                type: "object",
                description: "Instead of speed: the pulley that drives it.",
                properties: {
                  object: { type: "string", description: "The pulley." },
                  axis: {
                    type: "string",
                    enum: ["x", "y", "z"],
                    description: "The pulley's own axis it turns about.",
                  },
                  radius: {
                    type: "number",
                    description: "Where the belt rides on it, in metres.",
                  },
                },
                required: ["object", "axis", "radius"],
                additionalProperties: false,
              },
            },
            required: ["object", "pulleys"],
            additionalProperties: false,
          },
          description:
            "Belts and chains laid round their pulleys or sprockets.",
        },
        clear: {
          type: "array",
          items: { type: "string" },
          description:
            "Objects whose keys, aim and follows are removed, each left where it is now; /Spring_.*/ stands for every object whose whole name it matches.",
        },
        ...motionExtension,
      },
      additionalProperties: false,
    },
  },
  {
    name: "blender_frame_sheet",
    toolkit: toolkits.motion.id,
    label: "Look at frames of a 3D animation",
    access: "read",
    checksWork: "runs",
    description: `Check an animation: frames from a start time, every so many milliseconds, drawn side by side on one picture you can see, each labelled with its time, and, at each time, where each moving object is, turned how, and what it goes into. What goes into what is measured on the parts' surfaces, not their boxes, and the deepest overlaps come first: between parts of a mechanism they are clashes. Every frame from the first to the last drawn is also stepped through, up to ${statedNumbers.frames.most_scanned} frames and past them every so many, for parts going into each other between the frames drawn, pops, turns that flip or are too fast for the frame rate, parts that slide or slip where they rest, aimed parts whose distance to their target changes, objects leaving the camera's picture, and the fastest parts. The fastest parts and those that accelerate hardest are named, parts named as feet or wheels are measured for how far they go into what they stand on, and each simulation is said read from its bake or stepped from its start. With pictures false it checks every frame from start to end in numbers only. Use it after animating, and look at it before calling a motion finished: you cannot watch a video. It changes nothing. ${timeLimitStated("frames")}`,
    inputSchema: {
      type: "object",
      properties: {
        start: {
          type: "number",
          default: 0,
          description: "The first frame's time, in seconds.",
        },
        every_ms: {
          type: "number",
          description: "Milliseconds between frames.",
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: 36,
          default: 12,
          description: "How many frames.",
        },
        frame_width: {
          type: "integer",
          minimum: 160,
          maximum: 640,
          default: 320,
          description: "Each frame's width in pixels.",
        },
        view: {
          type: "string",
          enum: ["camera", "overview", "objects"],
          description:
            "camera (default): through the scene camera; overview: the whole scene from above and in front; objects: from the same side, framed on the objects named, wherever they go in these frames, to see a small mechanism up close.",
        },
        engine: {
          type: "string",
          enum: ["eevee", "solid"],
          description:
            "eevee (default) as lit; solid as Blender's solid view draws it, quicker, in each surface's colour.",
        },
        objects: {
          type: "array",
          items: { type: "string" },
          maxItems: mostFollowed,
          description: `Up to ${mostFollowed} objects whose places are given at each time; every moving one by default. A name between slashes, such as /Spring_.*/, stands for every object whose whole name it matches; the answer says which.`,
        },
        loop: {
          type: "boolean",
          description:
            "true for a motion meant to repeat: says whether the frame after the timeline's last runs on into its first, in place and speed.",
        },
        pictures: {
          type: "boolean",
          description:
            "false: no pictures, a report in numbers of every frame from start to end however many, until most of the call's time is spent; every_ms and count are not needed.",
        },
        end: {
          type: "number",
          maximum: longestTimeline,
          description:
            "With pictures false: the last time checked, in seconds; the timeline's end by default.",
        },
        allowed: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 2,
          },
          description:
            'Pairs of parts that touch by design, such as gears that mesh or a shaft in its bearing: [["Gear_A", "Gear_B"]], each a name or /pattern/. Their overlaps are said apart, with how deep.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "blender_close_ups",
    toolkit: toolkits.motion.id,
    label: "Look closely at parts of a 3D scene",
    access: "read",
    checksWork: "runs",
    description: `Look closely at objects, as a picture of the whole cannot: each object framed on itself and a margin round it, where it meets what it joins, from the side the rest of the scene covers least and from the side opposite, side by side on one picture you can see, each labelled with its name and side. The answer gives each object's line as blender_describe_scene does: its size and place, what it goes into, holes in its surface and faces that cross each other with where they are, and a tube's end that meets nothing. Use it on every joint that matters before a final render: a hose's ends, a cover on its seat, a part sunk into another. It changes nothing. ${timeLimitStated("closeups")}`,
    inputSchema: {
      type: "object",
      properties: {
        objects: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: mostFollowed,
          description: `Up to ${mostFollowed} objects, each on a row of its own. A name between slashes, such as /Spring_.*/, stands for every object whose whole name it matches; the answer says which.`,
        },
        main: {
          type: "integer",
          minimum: 1,
          maximum: mostFollowed,
          description:
            "Instead of objects: how many of the objects the scene is mostly about, those the camera shows most past the floor, walls and table they stand in, with any whose pieces of one material pass into each other first.",
        },
        time: {
          type: "number",
          description:
            "The moment of the animation to look at, in seconds; the scene's own by default.",
        },
        tile_width: {
          type: "integer",
          minimum: 160,
          maximum: 800,
          default: 480,
          description: "Each picture's width in pixels.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "blender_render_video",
    toolkit: toolkits.motion.id,
    label: "Render a 3D animation to a video",
    checksWork: "runs",
    description: `Render the animation through the scene camera, or the camera named, to an .mp4 video in the workspace, for the person to watch or to hand over. You cannot see a video: check the motion with blender_frame_sheet before making one. EEVEE by default; Cycles looks as a final render does and takes far longer for every frame. every draws a quick draft from every so many frames, played at its real speed; slow_motion stretches time. One too long for a call is drawn frame by frame over several calls with the same inputs, each saying the frames made, those left and the time they take, and written once the last is made. A simulation not baked, or baked over fewer frames than the video shows, is refused unless Blender can work it out frame by frame as it renders from its start. ${longestVideoStated} ${timeLimitStated("video")}`,
    inputSchema: {
      type: "object",
      properties: {
        output: workspaceFile(
          "Workspace-relative .mp4 path, or a whole path outside the workspace, which the person approves; without #, which Blender replaces with frame numbers.",
        ),
        camera: {
          type: "string",
          description:
            "Render this video through this camera; the scene keeps its own camera.",
        },
        start: {
          type: "number",
          maximum: longestTimeline,
          default: 0,
          description: "From this time, in seconds.",
        },
        end: {
          type: "number",
          maximum: longestTimeline,
          description:
            "To this time, in seconds; the timeline's end by default.",
        },
        engine: {
          type: "string",
          enum: ["eevee", "cycles"],
          description: "eevee by default.",
        },
        samples: {
          type: "integer",
          description: `Per frame: EEVEE ${statedNumbers.video.eevee_samples}, Cycles ${statedNumbers.video.cycles_samples} by default.`,
        },
        resolution: {
          ...point2,
          description:
            "Width and height in pixels, each made even as a video needs; the scene's picture size by default.",
        },
        every: {
          type: "integer",
          minimum: 1,
          maximum: 24,
          description:
            "Draws every so many frames, each held as long as those it stands for: a quick draft at its real speed.",
        },
        slow_motion: {
          type: "number",
          minimum: 1,
          maximum: 8,
          description:
            "Plays this many times slower, the motion worked out between frames: 2 plays 1 s of the animation over 2 s.",
        },
        sampling: {
          ...renderSampling.sampling,
          description:
            "Cycles, for this video alone; its seed changes each frame, so noise does not stay put as the picture moves.",
        },
      },
      required: ["output"],
      additionalProperties: false,
    },
  },
];
