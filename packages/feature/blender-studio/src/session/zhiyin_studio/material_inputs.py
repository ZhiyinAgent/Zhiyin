"""
The Principled inputs a material takes beyond its colour, metal and roughness: the coat's tint
and refraction, the tint of a surface's reflections, the roughness of its diffuse light and how
its reflections are worked out. Each is set on every call, to Blender's own default when not
given, and the answer names each that is not the default, with what an engine will not show.
"""

from .arguments import colour, need, number
from .wording import hex_of, one_of

# How reflections are worked out: multiscatter GGX keeps the light a rough surface reflects
# between its own bumps, GGX loses it.
DISTRIBUTIONS = {"multiscatter-ggx": "MULTI_GGX", "ggx": "GGX"}
WHITE = "#ffffff"
# The least and most of a material's amounts: metal, roughness, wood, each mark, transmission, opacity, a coat.
AMOUNT = (0, 1)


def set_inputs(shader, values):
    """Sets the coat's tint and ior, the reflections' tint, the diffuse roughness and the distribution; what the answer says of them."""
    inputs, said = shader.inputs, []
    coat = inputs["Coat Weight"].default_value
    tint = colour(values.get("coat_tint"), "coat_tint", default=WHITE)
    inputs["Coat Tint"].default_value = tint
    inputs["Coat IOR"].default_value = number(values.get("coat_ior"), "coat_ior", minimum=1, maximum=4, default=1.5)
    unseen = " (shown only under a coat, and its coat is 0)" if coat <= 0 else ""
    if hex_of(tint) != WHITE:
        said.append(f"coat tint {hex_of(tint)}{unseen}")
    if abs(inputs["Coat IOR"].default_value - 1.5) > 1e-6:
        said.append(f"coat ior {inputs['Coat IOR'].default_value:g}{unseen}")
    specular = colour(values.get("specular_tint"), "specular_tint", default=WHITE)
    inputs["Specular Tint"].default_value = specular
    if hex_of(specular) != WHITE:
        # On a metal the tint colours its edges; on anything else, its reflections seen face on.
        where = "its edges' reflections" if inputs["Metallic"].default_value >= 0.5 else "its reflections"
        said.append(f"specular tint {hex_of(specular)} on {where}")
    rough = number(values.get("diffuse_roughness"), "diffuse_roughness", minimum=AMOUNT[0], maximum=AMOUNT[1], default=0)
    inputs["Diffuse Roughness"].default_value = rough
    if rough > 0:
        said.append(f"diffuse roughness {rough:g}, as chalk, clay or cloth scatter light (Cycles only: EEVEE draws it smooth)")
    distribution = values.get("distribution", "multiscatter-ggx")
    need(distribution in DISTRIBUTIONS, f"distribution is {one_of(DISTRIBUTIONS)}.")
    shader.distribution = DISTRIBUTIONS[distribution]
    if distribution == "ggx":
        said.append("GGX reflections, which lose some of the light a rough surface reflects: multiscatter GGX, the default, keeps it")
    return said
