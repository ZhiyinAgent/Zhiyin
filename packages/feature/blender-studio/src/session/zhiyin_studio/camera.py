"""
blender_set_camera: the scene's camera framing objects from any side, or placed and aimed, with
its lens, focus, picture size, exposure and tone, and what the picture then shows.
"""

import math

import bpy
import mathutils

from .aiming import keeps_focus, lens_shift, look_at, place_to_fit, refocus, vertical
from .arguments import need, number, vector
from .describe import in_picture
from .finding import find_object, find_objects, link, scene, subjects
from .geometry import middle_of, outline_points
from .stylised_lines import set_outlines
from .tone import set_tone
from .wording import length, point_text

DIRECTIONS = {
    "front": (0, -1, 0.15),
    "back": (0, 1, 0.15),
    "left": (-1, 0, 0.15),
    "right": (1, 0, 0.15),
    "three-quarter": (1, -1, 0.7),
    "top": (0, 0, 1),
}


def frame(camera, targets, direction, margin, aspect, ahead):
    """
    Places the camera along a direction so the targets fill the picture. It
    fits their shapes, not their boxes: a round thing seen from a corner of
    its box would otherwise sit small in a picture sized for that corner.
    """
    bpy.context.view_layer.update()
    points = [p for target in targets for p in outline_points(target)]
    need(points, "There is nothing visible to frame.")
    return place_to_fit(camera, direction, points, aspect, margin, ahead)


def heading(direction, elevation, around=None):
    """
    A preset direction, moved round the objects by `around` degrees,
    anticlockwise seen from above, and raised to an elevation in degrees above
    level. With it comes the level direction that is up the picture when the
    camera looks straight down: the far side from where it came round to.
    """
    turn = mathutils.Matrix.Rotation(
        math.radians(number(around, "frame around", minimum=-360, maximum=360)) if around is not None else 0, 3, "Z"
    )
    direction = turn @ mathutils.Vector(direction)
    level = mathutils.Vector((direction.x, direction.y, 0))
    if level.length < 1e-6:
        # Straight above is on no side of its own: it is turned from the front.
        level = turn @ mathutils.Vector((0, -1, 0))
    level.normalize()
    if elevation is not None:
        rise = math.radians(number(elevation, "frame elevation", minimum=-60, maximum=90))
        direction = (level.x * math.cos(rise), level.y * math.cos(rise), math.sin(rise))
    return tuple(direction), tuple(-level)


SIDES = ("front", "front-right", "right", "back-right", "back", "back-left", "left", "front-left")
# The space round what is framed, as a share of the picture: least, most and by default.
MARGIN = (0, 0.9, 0.1)
# A blur's f-stop: least, most and by default.
APERTURE = (0.5, 128, 2.8)


def up_the_picture(ahead):
    """Which way is up the picture of a camera that looks straight down, in the scene's axes."""
    turn = round(math.degrees(math.atan2(-ahead[0], ahead[1]))) % 360
    axis = {0: "+y", 90: "-x", 180: "-y", 270: "+x"}.get(turn)
    return f"{axis} up the picture" if axis else f"up the picture is {turn}° anticlockwise from +y"


def side_of(way, ahead):
    """Where a camera looks from, in degrees round from the front and by its side."""
    if vertical(way):
        return f"straight from above, {up_the_picture(ahead)}"
    turn = round(math.degrees(math.atan2(way[0], -way[1])))
    return f"{turn}° round from the front, on the {SIDES[round(turn / 45) % 8]} side"


def plan_reading(camera, point):
    """Says which way is up the picture of a camera aimed straight down or up by hand."""
    return ", +y up the picture" if vertical(camera.location - mathutils.Vector(point)) else ""


def scene_camera():
    camera = scene().camera
    if camera is None:
        data = bpy.data.cameras.new("Camera")
        camera = link(bpy.data.objects.new("Camera", data))
        scene().camera = camera
    return camera


@keeps_focus
def set_camera(args, scene_file):
    need(
        args.get("effects") is None,
        'Picture effects are blender_render\'s post: give them there, such as post [{"step": "vignette"}], kept for every later render.',
    )
    camera = scene_camera()
    data = camera.data
    render = scene().render
    said = []
    if args.get("resolution") is not None:
        width, height = vector(args["resolution"], "resolution", 2)
        need(16 <= width <= 16384 and 16 <= height <= 16384, "resolution must be between 16 and 16384 pixels each way.")
        render.resolution_x, render.resolution_y = int(width), int(height)
        said.append(f"{int(width)}×{int(height)} pixels")
    if args.get("orthographic") is not None:
        need(isinstance(args["orthographic"], bool), "orthographic is true or false.")
        data.type = "ORTHO" if args["orthographic"] else "PERSP"
    data.lens = number(args.get("lens"), "lens", minimum=4, maximum=1200, default=data.lens)
    said.append(f"{data.lens:g} mm lens" if data.type != "ORTHO" else "orthographic")
    if args.get("shift") is not None:
        across, up = vector(args["shift"], "shift", 2)
        need(abs(across) <= 1 and abs(up) <= 1, "shift is two numbers from -1 to 1: across and up, each a share of the picture's longer side.")
        data.shift_x, data.shift_y = across, up
    # Said whoever set it, so a shift is never there unknown.
    said.append(lens_shift(data) or ("lens not shifted" if args.get("shift") is not None else ""))
    aspect = render.resolution_x / render.resolution_y
    if args.get("frame") is not None:
        spec = args["frame"]
        need(isinstance(spec, dict), "frame names the objects to fit and the direction to look from.")
        targets = find_objects(spec.get("objects") or []) or subjects()
        direction = spec.get("direction", "three-quarter")
        need(direction in DIRECTIONS, f"frame direction is one of {', '.join(DIRECTIONS)}.")
        margin = number(spec.get("margin"), "frame margin", minimum=MARGIN[0], maximum=MARGIN[1], default=MARGIN[2])
        way, ahead = heading(DIRECTIONS[direction], spec.get("elevation"), spec.get("around"))
        frame(camera, targets, way, margin, aspect, ahead)
        # A turn adds to the direction's own, so where it lands is said outright,
        # and so is which way is up a picture taken straight down.
        moved = f", {spec['around']:g}° round: {side_of(way, ahead)}" if spec.get("around") is not None else ""
        raised = f", {spec['elevation']:g}° above level" if spec.get("elevation") is not None else ""
        plan = f", {up_the_picture(ahead)}" if vertical(way) and not moved else ""
        said.append(
            f"framing {', '.join(o.name for o in targets) if spec.get('objects') else 'everything'} from the {direction}{moved}{raised}{plan}"
        )
        if data.type == "ORTHO":
            said.append(f"{length(data.ortho_scale)} across")
    else:
        need(
            args.get("look_at") is None or args.get("look_at_object") is None,
            "Aim at a point with look_at or at an object with look_at_object, not both.",
        )
        if args.get("location") is not None:
            camera.location = vector(args["location"], "location")
            said.append(f"at {point_text(camera.location)}")
        if args.get("look_at") is not None:
            point = vector(args["look_at"], "look_at")
            look_at(camera, point)
            said.append(f"looking at {point_text(point)}{plan_reading(camera, point)}")
        if args.get("look_at_object") is not None:
            target = find_object(args["look_at_object"])
            look_at(camera, middle_of(target))
            said.append(f"looking at the middle of {target.name}{plan_reading(camera, middle_of(target))}")
    dof = args.get("depth_of_field")
    if isinstance(dof, dict) and dof.get("off"):
        data.dof.use_dof = False
        data.pop("zhiyin_focus", None)
        said.append("no background blur")
    elif dof is not None:
        need(isinstance(dof, dict), "depth_of_field gives what to focus on (focus_object or focus_distance) and an aperture.")
        need(
            (dof.get("focus_object") is None) != (dof.get("focus_distance") is None),
            "depth_of_field focuses on an object (focus_object) or at a distance (focus_distance): give one of them.",
        )
        data.dof.use_dof = True
        data.dof.focus_object = None
        if dof.get("focus_object") is not None:
            data["zhiyin_focus"] = find_object(dof["focus_object"]).name
        else:
            data.pop("zhiyin_focus", None)
            data.dof.focus_distance = number(dof.get("focus_distance"), "focus_distance", minimum=0.001)
        data.dof.aperture_fstop = number(
            dof.get("aperture"), "aperture", minimum=APERTURE[0], maximum=APERTURE[1], default=APERTURE[2]
        )
        refocus(camera)
        focus = data.get("zhiyin_focus")
        said.append(f"background blur at f/{data.dof.aperture_fstop:g}, focused " + (f"on {focus}" if focus else f"{length(data.dof.focus_distance)} away"))
    if args.get("exposure") is not None:
        settings = scene().view_settings
        settings.exposure = number(args["exposure"], "exposure", minimum=-10, maximum=10)
        said.append(f"exposure {settings.exposure:+g}")
    if args.get("tone") is not None:
        set_tone(args["tone"])
        said.append(f"{args['tone']} tone")
    refocus(camera)
    bpy.context.view_layer.update()
    looks = []
    if args.get("outlines") is not None:
        looks.append(set_outlines(args["outlines"]))
    seen = in_picture(camera, subjects())
    return (
        f"Camera: {', '.join(part for part in said if part)}."
        + (f" It {'; '.join(seen)}." if seen else "")
        + "".join(f"\n{line[0].upper()}{line[1:]}." for line in looks)
    )
