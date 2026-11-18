"""
Data with no user that the scene file keeps all the same. Blender writes only data that has a user,
so saving and loading again would lose two kinds of data a single Blender holds on to:

- data something saved refers to without counting as its user, such as the collection a soft body
  collides with or an object only a boolean cuts with, which would load pointing at nothing;
- data a script made that nothing uses yet, such as a material made in one script for the next to
  assign, which a single Blender keeps until the scene is opened again.

Each is given a fake user while the file is written and loses it once the file is loaded, so it has
no user, as it had. Data a script made stays kept until something uses it or the scene is opened
with blender_open_scene; used and let go again, it goes, as Blender's own unused data does.
"""

import contextlib

import bpy

# Kept on data the file holds only because something saved refers to it.
KEPT_AS_REFERRED_TO = "_zhiyin_kept_as_referred_to"
# Kept on data a script made that nothing has used since.
MADE_UNUSED = "_zhiyin_made_unused"
# Pictures Blender makes for itself as it renders, which are no script's.
BLENDERS_OWN_PICTURES = ("RENDER_RESULT", "COMPOSITING")


def datablocks():
    """Every datablock the scene holds."""
    for held in bpy.data.bl_rna.properties:
        if held.type == "COLLECTION":
            for one in getattr(bpy.data, held.identifier):
                if isinstance(one, bpy.types.ID):
                    yield one


def held():
    """Which datablocks there are now, to tell later which a script made."""
    return {one.session_uid for one in datablocks()}


def mark_made(there):
    """Marks the data made since `there` that nothing uses, so every save keeps it until something does."""
    for one in datablocks():
        if one.session_uid in there or one.users or one.library is not None:
            continue
        if isinstance(one, bpy.types.Image) and one.type in BLENDERS_OWN_PICTURES:
            continue
        one[MADE_UNUSED] = True


def forget_made():
    """
    The data scripts made that nothing used is no longer kept, as a scene opened in Blender holds
    none: says whether there was any, which the file then holds until it is saved.
    """
    found = False
    for one in datablocks():
        if one.get(MADE_UNUSED) is not None:
            del one[MADE_UNUSED]
            found = True
    return found


def kept_unused():
    """
    The data with no user a save keeps: what a script made that nothing uses yet, and what anything
    saved refers to, those kept included. Data a script made that is used now is no longer marked.
    """
    unused = []
    for one in datablocks():
        if one.get(MADE_UNUSED) is not None and one.users:
            del one[MADE_UNUSED]
        elif not one.users and one.library is None:
            unused.append(one)
    if not unused:
        return set()
    kept = {one for one in unused if one.get(MADE_UNUSED) is not None}
    referred_by = bpy.data.user_map(subset=unused)
    while True:
        more = {
            one
            for one, users in referred_by.items()
            if one not in kept and any(user != one and (user.users > 0 or user in kept) for user in users)
        }
        if not more:
            return kept
        kept |= more


@contextlib.contextmanager
def kept_while_saving():
    """While the file is written, the data with no user it keeps has a fake user."""
    kept = kept_unused()
    for one in kept:
        one.use_fake_user = True
        if one.get(MADE_UNUSED) is None:
            one[KEPT_AS_REFERRED_TO] = True
    try:
        yield
    finally:
        for one in kept:
            one.use_fake_user = False
            if one.get(KEPT_AS_REFERRED_TO) is not None:
                del one[KEPT_AS_REFERRED_TO]


def as_saved():
    """Once a file is loaded, the data its save kept has no user again, as it had when saved."""
    for one in datablocks():
        if one.get(KEPT_AS_REFERRED_TO) is not None:
            one.use_fake_user = False
            del one[KEPT_AS_REFERRED_TO]
        elif one.get(MADE_UNUSED) is not None:
            one.use_fake_user = False
