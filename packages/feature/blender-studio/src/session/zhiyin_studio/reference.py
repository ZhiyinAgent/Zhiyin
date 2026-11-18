"""
Blender's Python API as this Blender has it, read by introspection: each type
in bpy.types with its own properties and functions, the operators by module,
and the bmesh, mathutils and bpy_extras modules a script uses. Nothing is
read from Blender's manual; every page names the version it was read from.
"""

import importlib
import inspect
import re

import bpy

# A module's page past this many characters becomes an index of its members'
# names, each member on a page of its own. A type is one page however long.
LARGEST_PAGE = 8_000

PYTHON_MODULES = (
    "bmesh",
    "bmesh.ops",
    "bmesh.types",
    "bmesh.utils",
    "bmesh.geometry",
    "mathutils",
    "mathutils.geometry",
    "mathutils.noise",
    "mathutils.bvhtree",
    "mathutils.kdtree",
    "mathutils.interpolate",
    "bpy_extras.anim_utils",
    "bpy_extras.mesh_utils",
    "bpy_extras.object_utils",
    "bpy_extras.io_utils",
    "bpy_extras.image_utils",
    "bpy.utils",
    "bpy.path",
)

NODE_TREES = (
    ("ShaderNode", "ShaderNodeTree"),
    ("GeometryNode", "GeometryNodeTree"),
    ("FunctionNode", "GeometryNodeTree"),
    ("CompositorNode", "CompositorNodeTree"),
)

# Panels, menus, operators and lists of Blender's own interface, which a
# script in a Blender without a window never uses: VIEW3D_PT_tools.
INTERFACE_CLASS = re.compile(r"^[A-Z0-9]+_[A-Z]{2,3}_")
# A docstring that opens with its own signature: ".. function:: name(args)".
SIGNED = re.compile(r"^\.\.\s+(?:function|method|class|classmethod|staticmethod)::\s*(.+)$")
# Sphinx's marks round a name: :class:`Vector` reads as Vector.
ROLE = re.compile(r":[a-z]+:`~?([^`]+)`")
# The type a C function's signature line opens with: "BMeshOpFunc bmesh.ops.bevel(".
RETURNED_TYPE = re.compile(r"^\w+\s+(?=[\w.]+\()")
PARAMETER = re.compile(r"[(,]\s*\*{0,2}(\w+)")
# A vector's components read together, as v.xy or v.zzyx: one line says them all.
SWIZZLE = re.compile(r"^[xyzw]{2,4}$")
ENUM_SHOWN = 40


def first_line(text):
    text = (text or "").strip()
    return text.split("\n", 1)[0].strip()


def page(name, summary, text, terms):
    return {"name": name, "summary": summary, "text": text, "terms": sorted(set(terms))}


def heading(name, version):
    return f"{name}, as Blender {version} has it."


def property_line(prop):
    """A property with its kind, its values or the type it holds, and its description."""
    text = f"- {prop.identifier} ({prop.type.lower()}"
    if prop.type == "ENUM":
        items = [i.identifier for i in prop.enum_items]
        if items:
            text += ": " + ", ".join(items[:ENUM_SHOWN]) + (" …" if len(items) > ENUM_SHOWN else "")
    elif prop.type in ("POINTER", "COLLECTION") and getattr(prop, "fixed_type", None) is not None:
        text += f" of {prop.fixed_type.identifier}"
    elif getattr(prop, "is_array", False) and getattr(prop, "array_length", 0):
        text += f"[{prop.array_length}]"
    if prop.is_readonly:
        text += ", read-only"
    text += ")"
    if prop.description:
        text += f": {prop.description}"
    return text


def parameter(prop):
    """A parameter as a call writes it: name=default."""
    if prop.is_required:
        return prop.identifier
    if getattr(prop, "is_array", False) and len(getattr(prop, "default_array", ()) or ()):
        value = tuple(round(v, 6) if isinstance(v, float) else v for v in prop.default_array)
    elif prop.type == "ENUM":
        value = set(prop.default_flag) if prop.is_enum_flag else prop.default
    elif prop.type in ("POINTER", "COLLECTION"):
        value = None
    else:
        value = getattr(prop, "default", None)
    if isinstance(value, float):
        value = round(value, 6)
    return f"{prop.identifier}={value!r}"


def rna_function(function):
    inputs = [p for p in function.parameters if not p.is_output]
    outputs = [p for p in function.parameters if p.is_output]
    text = f"- {function.identifier}({', '.join(parameter(p) for p in inputs)})"
    if outputs:
        text += " -> " + ", ".join(f"{p.identifier} ({p.type.lower()})" for p in outputs)
    if function.description:
        text += f": {function.description}"
    return text


def signed(name, member):
    """A member's signature and the rest of its docstring, roles read as plain names."""
    doc = ROLE.sub(r"\1", inspect.getdoc(member) or "")
    lines = doc.split("\n")
    found = SIGNED.match(lines[0].strip()) if lines else None
    if found:
        return found.group(1), "\n".join(lines[1:]).strip()
    try:
        signature = str(inspect.signature(member))
    except (TypeError, ValueError):
        signature = "(…)"
    if signature in ("(…)", "(*args, **kwargs)") and lines and "(" in lines[0]:
        # A function made in C says its signature in its first line, and may
        # say what it returns in the next.
        said = RETURNED_TYPE.sub("", lines[0].strip())
        rest = lines[1:]
        if rest and rest[0].strip().startswith("->"):
            said += " " + rest.pop(0).strip()
        return said, "\n".join(rest).strip()
    return f"{name}{signature}", doc.strip()


def parameter_names(signature):
    return PARAMETER.findall(signature)


def node_sockets(identifier):
    """A node's inputs and outputs, from one made in a tree of its kind, or nothing when it cannot be made."""
    kind = next((tree for prefix, tree in NODE_TREES if identifier.startswith(prefix)), None)
    if kind is None:
        return []
    tree = bpy.data.node_groups.new("Zhiyin reference", kind)
    try:
        try:
            node = tree.nodes.new(identifier)
        except RuntimeError:
            return []
        lines = [f"Node: {node.bl_label}, made as nodes.new('{identifier}')."]
        if node.inputs:
            lines.append("Inputs, by name:")
            lines += [f"- {s.name} ({s.type.lower()}{socket_default(s)})" for s in node.inputs]
        if node.outputs:
            lines.append("Outputs, by name:")
            lines += [f"- {s.name} ({s.type.lower()})" for s in node.outputs]
        return lines
    finally:
        bpy.data.node_groups.remove(tree)


def socket_default(socket):
    if not hasattr(socket, "default_value"):
        return ""
    value = socket.default_value
    if hasattr(value, "__len__") and not isinstance(value, str):
        value = tuple(round(v, 4) if isinstance(v, float) else v for v in value)
    elif isinstance(value, float):
        value = round(value, 4)
    return f", default {value!r}"


def type_page(name, kind, version):
    rna = kind.bl_rna
    base = rna.base
    inherited = set(base.properties.keys()) if base else set()
    inherited_functions = set(base.functions.keys()) if base else set()
    own = [p for p in rna.properties if p.identifier != "rna_type" and p.identifier not in inherited]
    functions = [f for f in rna.functions if f.identifier not in inherited_functions]
    written = [
        (member_name, member)
        for member_name, member in vars(kind).items()
        if not member_name.startswith(("_", "bl_rna_get_subclass"))
        and inspect.isroutine(member)
        and member_name not in rna.functions
    ]
    qualified = f"bpy.types.{name}"
    lines = [heading(qualified, version)]
    if rna.description:
        lines.append(rna.description)
    if base:
        lines.append(f"Based on bpy.types.{base.identifier}, whose page has what it inherits.")
    lines += node_sockets(name)
    if own:
        lines.append("Properties:")
        lines += [property_line(p) for p in own]
    if functions:
        lines.append("Functions:")
        lines += [rna_function(f) for f in functions]
    if written:
        lines.append("Python functions:")
        for member_name, member in written:
            signature, doc = signed(member_name, member)
            said = first_line(doc)
            lines.append(f"- {signature}" + (f": {said}" if said else ""))
    terms = [p.identifier for p in own] + [f.identifier for f in functions] + [n for n, _ in written]
    if rna.name and rna.name != name:
        terms.append(rna.name)
    return page(qualified, first_line(rna.description) or rna.name or name, "\n".join(lines), terms)


def operator_pages(module, version):
    """One page for an operator module, or, when that is too long, an index and a page for each operator."""
    qualified = f"bpy.ops.{module}"
    whole = [heading(qualified, version)]
    each = []
    names = []
    for name in sorted(dir(getattr(bpy.ops, module))):
        try:
            rna = getattr(getattr(bpy.ops, module), name).get_rna_type()
        except (AttributeError, KeyError, RuntimeError):
            continue
        properties = [p for p in rna.properties if p.identifier != "rna_type"]
        call = f"bpy.ops.{module}.{name}({', '.join(parameter(p) for p in properties)})"
        said = first_line(rna.description)
        whole.append(f"- {call}" + (f": {said}" if said else ""))
        names.append(name)
        lines = [heading(f"{qualified}.{name}", version)]
        if rna.description:
            lines.append(rna.description)
        lines.append(call)
        if properties:
            lines.append("Parameters:")
            lines += [property_line(p) for p in properties]
        each.append(page(f"{qualified}.{name}", said or name, "\n".join(lines), [name] + [p.identifier for p in properties]))
    summary = f"Blender's {module} operators"
    text = "\n".join(whole)
    if len(text) <= LARGEST_PAGE:
        return [page(qualified, summary, text, names)]
    index = [heading(qualified, version), f"Operators, each on a page of its own, as {qualified}.<name>:", ", ".join(names)]
    return [page(qualified, summary, "\n".join(index), names)] + each


def resolved(qualified):
    try:
        return importlib.import_module(qualified)
    except ImportError:
        pass
    head, _, rest = qualified.partition(".")
    try:
        module = importlib.import_module(head)
    except ImportError:
        return None
    for part in rest.split(".") if rest else []:
        module = getattr(module, part, None)
        if module is None:
            return None
    return module


def own_members(module, qualified):
    """What a module defines itself, leaving out what it imports from elsewhere."""
    homes = {None, qualified, getattr(module, "__name__", qualified)}
    if getattr(module, "__file__", None) is None:
        # A module made in C names its own classes as Python's.
        homes.add("builtins")
    found = []
    for name in sorted(dir(module)):
        member = getattr(module, name, None)
        if name.startswith("_") or inspect.ismodule(member) or not (callable(member) or inspect.isclass(member)):
            continue
        if getattr(member, "__module__", None) not in homes or getattr(member, "__name__", name) != name:
            continue
        found.append((name, member))
    return found


def class_page(qualified, member, version):
    signature, doc = signed(qualified.rsplit(".", 1)[1], member)
    lines = [heading(qualified, version), f"class {signature}"] + ([doc] if doc else [])
    names = []
    if any(SWIZZLE.match(name) for name in vars(member)):
        lines.append("- xy, zyx and every other group of up to four of x, y, z and w: those components, as a Vector")
    for name, value in sorted(vars(member).items()):
        if name.startswith("_") or SWIZZLE.match(name):
            continue
        signature, about = signed(name, value)
        said = first_line(about).removeprefix(":type: ")
        lines.append(f"- {signature if callable(value) else name}" + (f": {said}" if said else ""))
        names.append(name)
    return page(qualified, first_line(doc) or qualified, "\n".join(lines), [qualified.rsplit(".", 1)[1]] + names)


def python_pages(qualified, version):
    """
    A Python module's page, with a page for each class it defines; its
    functions are on its page, or, when that is too long, each on a page of
    its own with the module's page an index of their names.
    """
    module = resolved(qualified)
    if module is None:
        return []
    said = first_line(ROLE.sub(r"\1", inspect.getdoc(module) or ""))
    head = [heading(qualified, version)] + ([said] if said else [])
    members = own_members(module, qualified)
    classes = [(n, m) for n, m in members if inspect.isclass(m)]
    functions = [(n, m) for n, m in members if not inspect.isclass(m)]
    pages = [class_page(f"{qualified}.{n}", m, version) for n, m in classes]
    whole = list(head)
    if classes:
        whole.append("Classes, each on a page of its own: " + ", ".join(f"{qualified}.{n}" for n, _ in classes))
    each = []
    for name, member in functions:
        signature, doc = signed(name, member)
        indented = doc.replace("\n", "\n  ")
        whole.append(f"- {signature}" + (f"\n  {indented}" if doc else ""))
        each.append(
            page(
                f"{qualified}.{name}",
                first_line(doc) or f"{qualified}.{name}",
                "\n".join([heading(f"{qualified}.{name}", version), signature] + ([doc] if doc else [])),
                [name] + parameter_names(signature),
            )
        )
    names = [n for n, _ in members]
    text = "\n".join(whole)
    if len(text) <= LARGEST_PAGE:
        return [page(qualified, said or qualified, text, names)] + pages
    index = head + (
        [f"Classes, each on a page of its own: {', '.join(n for n, _ in classes)}"] if classes else []
    ) + [f"Functions, each on a page of its own, as {qualified}.<name>:", ", ".join(n for n, _ in functions)]
    return [page(qualified, said or qualified, "\n".join(index), names)] + pages + each


def build():
    """Every page, with the version they were read from."""
    version = bpy.app.version_string
    pages = []
    for name in sorted(dir(bpy.types)):
        kind = getattr(bpy.types, name, None)
        if kind is None or not hasattr(kind, "bl_rna") or INTERFACE_CLASS.match(name):
            continue
        try:
            pages.append(type_page(name, kind, version))
        except Exception as error:
            pages.append(page(f"bpy.types.{name}", name, f"{heading(f'bpy.types.{name}', version)}\nIt could not be read: {error}", [name]))
    for module in sorted(dir(bpy.ops)):
        pages += operator_pages(module, version)
    for qualified in PYTHON_MODULES:
        pages += python_pages(qualified, version)
    return {"version": version, "series": ".".join(str(n) for n in bpy.app.version[:2]), "pages": pages}
