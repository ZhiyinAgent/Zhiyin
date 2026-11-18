---
name: animations
description: >-
  Use when making a 3D animation in Blender: a turntable, a product reveal, something that moves, opens or falls, or a camera moving through a scene.
metadata:
  stage: animate render
  domain: animation
  gate: Every motion is checked in a frame sheet, with nothing passing through anything, jumping or floating, before the video is rendered.
  works-with: mechanical-design scene-stages rigging simulations
---

Animate like an animator who times things by watching the clock. You cannot watch a video, so you check motion by looking at frames, and the person watches the video you make at the end.

**Build the scene first,** as a still that is right, then animate it with blender_animate. Open toolkit:3d-rendering/motion for it and for the frame sheets, close-ups and video below. A machine's moving parts are designed in CAD before they move here: open skill:3d-rendering/mechanical-design. Times are in seconds and positions in metres, as everywhere else.

**Plan the motion as a few keys,** the moments that matter, and let Blender move smoothly between them: a lid closed at 0 s and open at 1.2 s, a ball on the table at 0 s and on the floor at 0.6 s. Set duration to how long the whole animation runs, with a short hold at the end so it does not stop on its last frame; left unset in a new scene, the timeline ends at the last key. Something that keeps running, such as a machine or a loop, has no hold: its driving keys reach the end of the timeline, or it looks as if it stalled.

**Give motion the timing real things have.**
- A falling object speeds up, so its landing key is eased in; something that slides to a stop is eased out; a camera starts and stops gently, eased in and out, which is how a path moves by default.
- A bounce is several keys, each lower and quicker than the last, reached eased in and left eased out.
- A turntable is one turn, rotation from 0 to 360 degrees, with linear easing so it neither starts nor stops, keyed with loop: true, which ends the timeline a frame before the turn comes round so no moment shows twice; loops do not ease. Check a loop with a frame sheet asked as a loop.
- Real things take time: a door opens in about a second, a hand lifts a cup in half of one, a camera crossing a room takes several.

**Parts of a mechanism move with each other.** Key the part that drives, such as a shaft turning at a steady speed with linear easing, and make the rest follow it. Then one change to the driving keys moves the whole mechanism, in step.
- A gear or a pulley turns at a ratio of what drives it: the driving one's teeth or diameter over its own, negative where the two turn opposite ways.
- A piston, a slider or a cam follower takes a formula of the driving turn.
- A value that follows from distances or turns, a lid that opens as a hand nears or a needle that reads a shaft's turn, is a drive, set live without Python.
- A mechanism with one control, a door's opening from 0 to 1, keys a custom property such as ["open"] and drives its parts from it.

**Rods and links aim.** Rods and links that join two moving parts are attached at one end and aimed at the other, with aim's facing set to the axis the rod's length runs along, such as facing z for a rod made upright: left at its default, aim points the part's front (-y) instead. An aim points at the target's origin, which for a part drawn from its base is not its middle; and a line to the target close to straight up or down cannot keep the part upright, so it turns round the line as the target moves across it.

**The scene holds the motion,** whatever a long conversation has forgotten of it: blender_describe_scene says what each part is keyed, aimed at and follows, so read it before keying a part again, since a part that follows has no keys of its own and moves all the same.

**Characters and physics.** A character or a creature is posed by its bones: rig it first (skill:3d-rendering/rigging), save its poses by name and key the poses, so a walk is a few poses timed like any other keys; a foot or a hand that must stay on something reaches for a target with IK. What falls, bounces off others, drapes or pours is not keyed by hand: simulate it (skill:3d-rendering/simulations), then keep the motion as keys with to_keys, or bake it.

**Cameras and vehicles follow paths.** Move a camera with a path through a few points rather than many keys, and keep it aimed at the subject with aim, so its framing holds as it moves. A vehicle on a road or a rail follows the curve drawn for it, facing ahead and banked into its turns; train cars or boxes on a conveyor ride the same route as a train, so far apart. Read the path's top speed in the answer against what the thing really does. Keys of an attached part are on what it is attached to, so a wheel on a cart turns with the cart and on its own axle.

**Check every motion with blender_frame_sheet** before calling it finished: frames side by side, each with its time, and where each moving object is at each.
- Look for what a viewer would notice: a part that passes through another, a jump between two frames, motion that is too fast or too slow, a camera that loses its subject, an object that floats or sinks at its keys.
- Look closely around the keys and contacts with frames a few tens of milliseconds apart.
- For a mechanism, check every frame in numbers with a frame sheet without pictures, naming the parts that touch by design, gears that mesh or a shaft in its bearing, as allowed; read the hardest accelerations, and for feet and wheels how far they sink into the floor.
- A still at any moment is blender_render with time, for checking light and colour then.

Fix what you find and look again.

**Make the video last** with blender_render_video, once the frames are right, and after baking any simulation in the scene. A draft first, with EEVEE at a small size and every 2nd or 3rd frame, is quick for the person to check; the final one uses the engine and size they want, and Cycles takes many times longer for each second of video. A video too long for one call is drawn over several: call again with the same inputs, changing nothing in the scene, until it is written. Say where the video is and how long it runs.

**Keys in a script.** Blender 5 keeps an action's F-curves in the channelbag of each data block's slot: obj.animation_data.action.fcurves is gone. Read a block's keys with fcurves_of(obj), which every script has.
