"""
Every simulation in the scene found and baked over the scene's timeline, in the order one depends on
another: rigid bodies, cloth, soft bodies, particles, dynamic paint, liquids and smoke, then
geometry nodes simulation zones. Each says its frames, the seconds it took and its cache's size and
place, or why it failed; one failing does not stop the rest. Freeing undoes every bake, so each
simulation follows changes again.

Nothing is written beside the scene, which a typed change writes only by the files it declares.
Point caches (rigid bodies, cloth, soft bodies, particles) are kept in the scene file, one set to
a disk cache switched to it. A liquid blender_simulate made is baked into a new folder in the
conversation's own home and freed by pointing it at another, so the cache it had stays for the
scene that named it while the caches stay under their cap. A simulation zone is baked to a temporary folder, measured there, and packed
into the scene file. Dynamic paint caches only in a folder beside the scene, a liquid the scene
made caches in one too, and a zone set to bake to a folder of its own keeps its files there: each
is left for a script to bake, and freeing leaves it as it is.
"""

import re
import shutil
import tempfile
import time

import bpy

from .disk_files import folder_size
from .finding import scene
from .sim_bake_zones import zone_checks
from .sim_liquid import DOMAIN, cache_folder
from .timeline import simulates
from .wording import listed


def size_text(count):
    for unit, step in (("MiB", 1024**2), ("KiB", 1024)):
        if count >= step:
            return f"{count / step:.3g} {unit}"
    return f"{count} B"


WORLD = "the rigid-body world"


class LeftAsItIs(Exception):
    """A simulation this bake leaves for a script, and why."""


class PointCache:
    """A simulation Blender keeps in a point cache: rigid bodies, cloth, soft bodies, particles, dynamic paint."""

    def __init__(self, label, cache, ranged=None):
        self.label, self.cache, self.ranged = label, cache, ranged

    def baked(self):
        return self.cache.is_baked

    def baked_range(self):
        """The frames its bake holds, or nothing when it is not baked."""
        return (self.cache.frame_start, self.cache.frame_end) if self.cache.is_baked else None

    def starts(self):
        """The frame Blender starts working it out from."""
        return self.cache.frame_start

    def bake(self):
        room = scene()
        self.cache.frame_start = room.frame_start
        self.cache.frame_end = room.frame_end
        if self.ranged is not None:
            self.ranged.frame_start = room.frame_start
            self.ranged.frame_end = room.frame_end
        switched = self.cache.use_disk_cache
        if switched:
            # A disk cache is a folder beside the scene; in the scene file it is kept with the scene.
            # Setting it on the rigid-body world ends Blender, and on any cache outside its context.
            if self.label == WORLD:
                raise LeftAsItIs(
                    "it is set to a disk cache, a folder beside the scene, which this writes none of:"
                    " bake it in a script, or give it the cache in memory in Blender"
                )
            with bpy.context.temp_override(scene=room, point_cache=self.cache):
                self.cache.use_disk_cache = False
        with bpy.context.temp_override(scene=room, point_cache=self.cache):
            if self.cache.is_baked:
                bpy.ops.ptcache.free_bake()
            bpy.ops.ptcache.bake(bake=True)
        if not self.cache.is_baked:
            return None, f"Blender baked nothing: {self.cache.info}"
        found = re.search(r"\(([^)]+)\)", self.cache.info)
        kept = f"{found.group(1) if found else 'its cache'} kept in the scene file"
        return kept + (", its disk cache switched off, as this writes no folder beside the scene" if switched else ""), None

    def free(self):
        # Freeing a disk cache deletes its files beside the scene.
        if self.cache.use_disk_cache:
            return False
        with bpy.context.temp_override(scene=scene(), point_cache=self.cache):
            bpy.ops.ptcache.free_bake()
        return True


class Liquid:
    """
    A fluid domain, liquid or smoke, baked whole to its cache folder. Only a domain blender_simulate
    made is baked or freed: a cache folder of the scene's own lies beside it, where pointing the
    domain elsewhere deletes the files Blender left there.
    """

    def __init__(self, obj, domain):
        self.obj, self.domain = obj, domain
        self.label = f"{'liquid' if domain.domain_type == 'LIQUID' else 'smoke'} in {obj.name}"

    def baked(self):
        return self.domain.has_cache_baked_any

    def baked_range(self):
        return (self.domain.cache_frame_start, self.domain.cache_frame_end) if self.baked() else None

    def starts(self):
        return self.domain.cache_frame_start

    def override(self):
        return bpy.context.temp_override(scene=scene(), object=self.obj, active_object=self.obj)

    def fresh_folder(self):
        """Points the domain at a new folder of its own, so the cache it had, wherever it was, stays as it is."""
        self.domain.cache_directory = cache_folder()

    def own(self):
        return bool(self.obj.get(DOMAIN))

    def bake(self):
        if not self.own():
            raise LeftAsItIs(
                "its cache folder is the scene's own, beside it, which this writes none of: bake it in a script,"
                " with bpy.ops.fluid.bake_all() under bpy.context.temp_override(object=domain, active_object=domain),"
                " or make the liquid with blender_simulate's liquid"
            )
        room, domain = scene(), self.domain
        domain.cache_frame_start = room.frame_start
        domain.cache_frame_end = room.frame_end
        # Replay keeps no bake; All bakes every part the domain has.
        if domain.cache_type == "REPLAY":
            domain.cache_type = "ALL"
        self.fresh_folder()
        with self.override():
            if domain.has_cache_baked_any:
                bpy.ops.fluid.free_all()
            bpy.ops.fluid.bake_all()
        if not domain.has_cache_baked_data:
            reached = domain.cache_frame_pause_data
            return None, f"it stopped at frame {reached}" if reached else "Blender baked nothing"
        size = size_text(folder_size(bpy.path.abspath(domain.cache_directory)))
        return f"{size} kept in this conversation's own folder, for renders of the scene", None

    def free(self):
        if not self.own():
            return False
        self.fresh_folder()
        with self.override():
            bpy.ops.fluid.free_all()
        return True


# Simulation zones Zhiyin baked, by "object/modifier/bake id", kept on the scene: a zone's bake
# says nothing of whether it holds data. And the frames each was baked over, by the same key.
BAKED_ZONES = "zhiyin_baked_zones"
ZONE_RANGES = "zhiyin_baked_zone_ranges"


class Zone:
    """A geometry nodes simulation zone, baked by its modifier's bake of it."""

    def __init__(self, obj, step, bake, several):
        self.obj, self.step, self.bake_id = obj, step, bake.bake_id
        named = f" {bake.node.name}" if several else ""
        self.label = f"the simulation zone{named} of {step.name} on {obj.name}"
        self.key = f"{obj.name}/{step.name}/{bake.bake_id}"

    def entry(self):
        return next(b for b in self.step.bakes if b.bake_id == self.bake_id)

    def baked(self):
        return self.key in list(scene().get(BAKED_ZONES, []))

    def baked_range(self):
        if not self.baked():
            return None
        kept = scene().get(ZONE_RANGES, {}).get(self.key)
        return (int(kept[0]), int(kept[1])) if kept is not None else None

    def starts(self):
        return scene().frame_start

    def mark(self, baked):
        room = scene()
        keys = [k for k in room.get(BAKED_ZONES, []) if k != self.key]
        room[BAKED_ZONES] = keys + ([self.key] if baked else [])
        ranges = {k: list(v) for k, v in room.get(ZONE_RANGES, {}).items() if k != self.key}
        if baked:
            ranges[self.key] = [room.frame_start, room.frame_end]
        room[ZONE_RANGES] = ranges

    def on_disk(self):
        """Whether the zone keeps its bake in a folder of its own rather than in the scene file."""
        entry = self.entry()
        target = entry.bake_target if entry.bake_target != "INHERIT" else self.step.bake_target
        return target == "DISK"

    def run(self, operator):
        with bpy.context.temp_override(object=self.obj, active_object=self.obj, selected_objects=[self.obj]):
            operator(session_uid=self.obj.session_uid, modifier_name=self.step.name, bake_id=self.bake_id)

    def bake(self):
        entry = self.entry()
        entry.use_custom_simulation_frame_range = False
        if self.on_disk():
            raise LeftAsItIs("it keeps its bake in a folder of its own, which this writes none of: set its bake to pack into the scene file, or bake it in a script")
        self.run(bpy.ops.object.geometry_node_bake_delete_single)
        kept = (entry.bake_target, entry.use_custom_path, entry.directory)
        temporary = tempfile.mkdtemp(prefix="zhiyin-zone-")
        try:
            entry.bake_target, entry.use_custom_path, entry.directory = "DISK", True, temporary
            self.run(bpy.ops.object.geometry_node_bake_single)
            size = folder_size(temporary)
            self.run(bpy.ops.object.geometry_node_bake_pack_single)
        finally:
            entry = self.entry()
            entry.bake_target, entry.use_custom_path, entry.directory = kept
            shutil.rmtree(temporary, ignore_errors=True)
        if not size:
            return None, "Blender baked nothing"
        self.mark(True)
        return f"{size_text(size)} kept in the scene file", None

    def free(self):
        # Deleting a bake kept in a folder of its own deletes its files there.
        if self.on_disk():
            return False
        self.run(bpy.ops.object.geometry_node_bake_delete_single)
        self.mark(False)
        return True


def zones_of(obj, step):
    found = [b for b in step.bakes if b.node is not None and b.node.bl_idname == "GeometryNodeSimulationOutput"]
    return [Zone(obj, step, bake, len(found) > 1) for bake in found]


def simulations():
    """Every simulation in the scene, in the order they are baked."""
    room = scene()
    ranks = [[] for _ in range(6)]
    world = room.rigidbody_world
    if world is not None and world.enabled:
        ranks[0].append(PointCache(WORLD, world.point_cache))
    for obj in room.objects:
        for step in obj.modifiers:
            if step.type == "CLOTH":
                ranks[1].append(PointCache(f"cloth on {obj.name}", step.point_cache))
            elif step.type == "SOFT_BODY":
                ranks[2].append(PointCache(f"soft body on {obj.name}", step.point_cache))
            elif step.type == "PARTICLE_SYSTEM":
                system = step.particle_system
                if system.settings.type == "EMITTER" or system.use_hair_dynamics:
                    ranks[3].append(PointCache(f"particles {step.name} on {obj.name}", system.point_cache))
            elif step.type == "DYNAMIC_PAINT" and step.canvas_settings is not None:
                for surface in step.canvas_settings.canvas_surfaces:
                    ranks[4].append(Painted(obj, surface))
            elif step.type == "FLUID" and step.fluid_type == "DOMAIN":
                ranks[5].append(Liquid(obj, step.domain_settings))
    zones = [z for obj in room.objects for step in obj.modifiers if step.type == "NODES" and step.node_group is not None and simulates(step.node_group) for z in zones_of(obj, step)]
    return [s for rank in ranks for s in rank] + zones


class Painted(PointCache):
    """A dynamic paint surface, whose cache Blender keeps only in a folder beside the scene: left for a script."""

    def __init__(self, obj, surface):
        super().__init__(f"dynamic paint {surface.name} on {obj.name}", surface.point_cache, ranged=surface)
        self.surface = surface

    def bake(self):
        raise LeftAsItIs(
            "Blender keeps its cache only in a folder beside the scene, which this writes none of:"
            " bake it in a script, with bpy.ops.ptcache.bake(bake=True) under"
            " bpy.context.temp_override(scene=scene, point_cache=surface.point_cache)"
        )

    def free(self):
        return False


def bake_all():
    """Bakes every simulation in order; the line saying what each baked, and the zones' checks."""
    room = scene()
    found = simulations()
    if not found:
        return ["The scene holds no simulation to bake."]
    before = room.frame_current
    lines, zones = [], []
    try:
        for simulation in found:
            started = time.perf_counter()
            try:
                kept, failed = simulation.bake()
            except LeftAsItIs as reason:
                lines.append(f"Left {simulation.label} unbaked: {reason}.")
                continue
            except Exception as error:
                kept, failed = None, str(error).strip() or type(error).__name__
            seconds = time.perf_counter() - started
            if failed:
                lines.append(f"Baking {simulation.label} failed: {failed}.")
                continue
            line = f"Baked {simulation.label}: frames {room.frame_start} to {room.frame_end} in {seconds:.2f} s, {kept}"
            if isinstance(simulation, Zone):
                zones.append((simulation, len(lines)))
            lines.append(line)
        checks = zone_checks([z.obj for z, _ in zones])
        for zone, at in zones:
            said = checks.get(zone.obj.name)
            lines[at] += f"; {said}" if said else ""
        lines = [line if line.endswith(".") else line + "." for line in lines]
    finally:
        room.frame_set(before)
    return lines


def free_all():
    """Frees every bake it may; the lines naming those freed and those left baked, whose files are beside the scene."""
    freed, left = [], []
    for simulation in simulations():
        was = simulation.baked()
        if simulation.free():
            freed += [simulation.label] if was else []
        elif was:
            left.append(simulation.label)
    lines = [f"Freed the bakes of {listed(freed)}: each follows changes again."] if freed else []
    if left:
        lines.append(f"Left the bakes of {listed(left)} as they are: their files are beside the scene, which this does not change.")
    return lines or ["Nothing in the scene was baked."]
