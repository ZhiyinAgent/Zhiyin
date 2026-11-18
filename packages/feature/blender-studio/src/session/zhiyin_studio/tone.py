"""
How the scene's light becomes a picture's colours: the tone, by the tools' names for
Blender's view transforms, and the exposure.
"""


from .arguments import need
from .finding import scene
from .render_post import effects_text

# How the scene's light becomes the picture's colours: the tools' names for
# Blender's view transforms.
TONES = {"agx": "AgX", "neutral": "Khronos PBR Neutral", "standard": "Standard"}


def set_tone(name):
    need(name in TONES, f"tone is one of {', '.join(TONES)}.")
    settings = scene().view_settings
    settings.view_transform = TONES[name]
    settings.look = "None"


def tone_text():
    """The picture's tone and, when it is not 0, its exposure."""
    settings = scene().view_settings
    named = next((k for k, v in TONES.items() if v == settings.view_transform), settings.view_transform)
    said = f"{named} tone"
    if abs(settings.exposure) > 1e-6:
        said += f", exposure {settings.exposure:+g}"
    return said + effects_text()
