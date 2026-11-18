"""
Groups of a part's faces, named by the script, such as its machined faces or
the faces a cutaway leaves: the 3D studio gives each group a material of its
own. A script names them when it shows the part, or a helper names them as
it makes them; either way a group names faces of the part as it is shown,
moved or not, and a face changed by a later cut is a new face, in no group.
"""

# Faces named by the helpers as they made them, each with its group's name,
# for the parts shown after: a face's own shape, whatever its place.
_named = []


def name(faces, group):
    """Names faces as a group: what a helper made, such as a cutaway's cut faces."""
    for face in faces:
        _named.append((face.wrapped, group))


def forget():
    """Each run starts with no faces named."""
    _named.clear()


def faces_of(shape):
    """The part's faces, each once, in the order its mesh is written: copies of one face in a pattern are each a face."""
    return list(shape.faces())


def _key(face):
    """The same for a face wherever it is placed: its shape at no place."""
    from OCP.TopLoc import TopLoc_Location

    return hash(face.Located(TopLoc_Location()))


def groups(shape, given, refuse):
    """
    Each group of the part's faces as numbers into faces_of(shape): those the
    script gives, as {name: faces}, then those the helpers named. A face the
    script names that is not one of the part's is refused, through `refuse`;
    a face in two groups is in the one the script named, or the first.
    """
    order = {}
    for index, face in enumerate(faces_of(shape)):
        order.setdefault(_key(face.wrapped), []).append((index, face.wrapped))

    def index_of(face):
        # The very face, or else the same face before the part was moved.
        alike = order.get(_key(face), ())
        for index, own in alike:
            if own.IsSame(face):
                return index
        for index, own in alike:
            if own.IsPartner(face):
                return index
        return None

    found, taken = {}, set()
    for group, faces in (given or {}).items():
        if not isinstance(group, str) or not group.strip():
            refuse("Each group of surfaces is named by a word, such as “machined”.")
        listed = [faces] if hasattr(faces, "wrapped") else list(faces)
        if not listed:
            refuse(f"The surfaces “{group}” name no face.")
        indexes = []
        for face in listed:
            if not hasattr(face, "wrapped") or type(face).__name__ != "Face":
                refuse(f"The surfaces “{group}” are faces of the part, such as part.faces().filter_by(Axis.Z); one is a {type(face).__name__}.")
            index = index_of(face.wrapped)
            if index is None:
                refuse(
                    f"A face of the surfaces “{group}” is not one of the part's: name the faces of the part as it is shown, "
                    "after every cut, since a cut makes the faces it changes anew."
                )
            if index not in taken:
                taken.add(index)
                indexes.append(index)
        found[group.strip()] = indexes
    for face, group in _named:
        index = index_of(face)
        if index is not None and index not in taken:
            taken.add(index)
            found.setdefault(group, []).append(index)
    return {group: sorted(indexes) for group, indexes in found.items() if indexes}
