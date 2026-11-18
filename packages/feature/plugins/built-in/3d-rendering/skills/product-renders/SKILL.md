---
name: product-renders
description: >-
  Use when making product pictures for a shop, a catalogue or social media: studio lighting, materials that read as real, labels, and framing.
metadata:
  stage: model surface light render
  domain: product
  gate: The product reads as the real thing from the front and the three-quarter in a Cycles render, its label seated and its colours as asked.
  works-with: scene-stages lathe-profiles hard-surface-bevels simulations publishing/latex-typst-authoring
---

Make pictures a shop could publish. The product must look like the real thing: right proportions, materials that read as what they are, and a label that sits where it would.

**Model the product at its real size,** from the dimensions given or from what such a product usually measures. Shapes come from toolkit:3d-rendering/modelling and materials from toolkit:3d-rendering/surfacing.
- Turned shapes such as bottles, jars and cans are best made with a revolve profile (skill:3d-rendering/lathe-profiles); a can's rim and base are slightly narrower than its body.
- Round sharp edges a little with a bevel, as skill:3d-rendering/hard-surface-bevels says: nothing manufactured has perfectly sharp edges.
- Walls are as thick as the real ones: glass 2 to 6 mm, often with a heavier base; ceramic 4 to 6 mm; moulded plastic 1 to 2 mm; sheet metal under 1 mm.

**Materials, as starting points:**
- Aluminium: metallic 1, roughness 0.2 to 0.35.
- Gold or brass: metallic 1, a warm yellow such as #d4a72c, roughness 0.15 to 0.3.
- Wood: wood 0.5 in the wood's own colour, such as #c9a678 for oak, #e3cfa8 for birch or #6b4a32 for walnut, roughness 0.5 to 0.7; wood 1 for a bold grain, as on pine.
- Glass or clear plastic: transmission 1, roughness 0 to 0.05, ior 1.45, and #ffffff when clear: any other colour tints all that is seen through it. A liquid: transmission 1, ior 1.33. Their colour filters the light that comes through them, once, however thick they are. Lit from behind by the white backdrop, a coloured liquid or tinted glass looks lighter than its colour, so give it a deeper one than it should look; the colour alone makes it, with no volume needed.
- Glossy plastic: metallic 0, roughness 0.2 to 0.3; matte plastic 0.5 to 0.7.
- Glazed ceramic: metallic 0, roughness 0.05 to 0.15, with a coat of 0.3 to 0.7.
- Paper or cardboard: roughness 0.8 to 0.9.
- Surfaces with a texture of their own take a finish rather than a script: textured-plastic for moulded casings, rubber for grips, feet and cables, machined-metal or plated-steel for bright metal parts, painted-metal for painted housings, cast-aluminium for cast bodies. Each is drawn at its real size, in the colour given or its own. Add wear for a used look and grime for a dirty one; a new product has neither.

**Put a label on with blender_add_decal** (toolkit:3d-rendering/decals): a picture or text on the surface where it lands, its answer giving its size on the surface, its worst stretch, how much runs off an edge, and whether it would flicker against the surface at the camera's distance.
- A label round a bottle, jar, can or tube is kind wrap, sized in metres as it is printed: paper, or clear film with its ink over white or not. Its answer gives the arc it covers in degrees and how far its width stretches where the profile tapers or curves under it, which a real label cannot do, so keep a paper label on the straight part.
- A label that wraps all round a can or bottle can instead be a picture texture: cylinder projection wraps it round, front projection puts it on the face seen from the front, across along x and up along z.
- Lettering takes a colour of its own, well apart from the label's: in the label's colour it is only an embossing that no one reads.

**A label made as its own object,** such as a thin plate with lettering, lies against the surface it is stuck to, with no gap and without sinking in. Round a jar or a bottle it is a thin band, a revolve profile a fraction of a millimetre thick just outside the surface, never a solid that fills the product; and its lettering is text bent to the surface's radius, because flat text touches a round surface only at its middle and stands off at its ends. A view from the three-quarter shows what a view from the front hides: lettering that floats, a label that sinks in.

**Cloth and loose pieces.** A cloth the product lies on or stands among, a napkin or a draped backdrop, is draped with blender_simulate (skill:3d-rendering/simulations), and a few loose pieces around it, beans or sweets, are dropped and settled where they rest, so they lie as real ones do.

**Light it with blender_set_lighting's product preset,** in toolkit:3d-rendering/light-and-camera with the camera: studio lights in a seamless white backdrop that curves up on every side, which gives soft shadows and clean reflections. It sets the neutral tone, so a colour renders as given: a grey of #777777 comes out close to #777777.
- The backdrop is white under and around the product and shades to a light grey higher up, as a studio sweep does; a render with background white makes everything but the product and its shadow exact white.
- Keep the camera's exposure at 0: lowering it greys the background with the product, and raising it or the lights to whiten the grey brightens the product with it.
- A white or very pale product on the white backdrop is drawn only by its shading and its shadow: when its colour is yours to choose, one with some depth reads far better.
- When one highlight is too bright, lower the light that makes it, by its name, or make that surface a little rougher; change a light too when one side needs more or a reflection hides the label.
- Give lights a kelvin rather than a tinted colour: 5600 for neutral daylight, 3200 for warm tungsten.

**Reflections.** A glossy product reflects the backdrop as a white surface beside it, so a deep glossy colour stays deep: keep backdrop_reflections at its default for glaze, paint, plastic and porcelain. A pale band across a glossy colour, with a hard edge where it reflects something beside it, is that setting raised, not a property of gloss. Chrome and glass show their shape through what they reflect: raise backdrop_reflections toward 1 for them alone, as in a real light tent. For the long clean highlight lines down a bottle, along a car or round a watch, add a strip: a reflection card (cards, kind reflection), seen only in reflections, or a strip light, an area light with shape rectangle and a size such as [0.1, 2], stood up beside the product. The card's answer names what it shows in, so move it until the product is among them.

**Frame it with blender_set_camera:** a lens of 85 to 100 mm flatters products and avoids distortion; frame the product from the front or the three-quarter with a margin of about 0.1. Use a square picture (2000 × 2000) for shops and a portrait one for social media when asked.

**Render in steps.**
- Check framing with quick EEVEE renders.
- Check colours with a small Cycles render (900 × 900, 64 samples): EEVEE shows less of the backdrop in glossy surfaces, so a deep glossy colour comes out lighter in Cycles, and it sees through one layer of glass at most, so judge glass and liquids only in Cycles.
- Render with Cycles at 256 samples or more for the final pictures.
- A marketplace's main picture must sit on pure white: render it with background white, which keeps the product's shadow on the floor and makes the rest exact white.
- Render with background transparent, as .png, when the shop places products on its own background.

Either way the backdrop still lights the product and shows in its reflections.
