# 0028. A look is data that fills fixed slots

Status: accepted

## Decision

### Looks

- **A look is a folder of values and pictures.** Each look has one stylesheet
  and the pictures it names. Its rules select the look by a `data-look`
  attribute, so a whole window or one small preview can wear it. No component
  stylesheet names a look; components read variables.
- **The list of looks is a value set in the contract**: the look ids, the
  default look and the strengths. The core checks a choice against it and the
  window builds its choices from it. What a look is called and how it is
  described are the window's words, kept beside the list in the window and
  required for every id by the type checker. The looks are Neutral, Ink and
  Dots; a new profile starts in Ink.
- **Slots are the places a look may draw a picture.** The set is fixed:
  - the ground behind the conversation and the pages shown before
    conversations open;
  - a band that drifts over that ground;
  - the side column's foot, after the last row of its list, so it is never
    behind a word, and scrolled to when the list is long;
  - the foot of every other page;
  - behind a page's title;
  - the marks: the mark beside the name, the small mark in a line of the
    conversation, and the large mark on the empty conversation's page, with
    whether it sits in the disc and rings.

  For each slot a look sets every variable the slot reads: the picture, or
  `none` to leave it empty, and its mask, opacity and placement. A look that
  leaves one undefined fails the theme check. Every look-only variable is
  named `--zy-look-…`.
- **A look may also repaint theme tokens**, colours and radii included, for
  both themes. The theme check holds a look's colours to the same contrast
  floors as the theme's, with the look's values put over the theme's.
- **The parts are dressed through variables that fall back to the part's own
  value.** Each part a look draws differently reads a `--zy-look-` variable
  with its own value as the fallback. A look that draws a part as the part
  does sets the variable to `initial`, which in CSS means the fallback is
  used. A look still sets every variable, and the theme check fails one that
  leaves a variable out.
- **Corner radii are tokens.** Every corner a stylesheet draws reads a step of
  the radius scale, or a pill or circle token. Shapes that differ between
  looks, such as a check mark or a step track, are variables with an image
  value, added with the look that first needs them.
- **Strength** is one multiplier on every slot's opacity: Subtle 0.5, Default
  1, Vivid 1.5. Marks do not follow it. A calm area kept behind the words is
  part of its slot and is set so that it does not grow with Vivid.
- **The choice is saved as Appearance is**: a look id and a strength with the
  settings, absent while it is the default. The main process reads it before
  the window opens and hands it to the page in its address, as it does a
  restart, and the page sets it before its first paint; it keeps the latest
  choice for a page reloaded after a crash. A choice made later is shown once
  the core has saved it and said so.
- **An id that is not on the list is not used.** The core refuses it as a
  command. A saved one is dropped as the settings are read, and the window
  opens in the default look; the rest of the settings stay sound.
- **Settings shows Look and Strength.** A look without pictures keeps the
  Strength row in its place, switched off, saying why. Onboarding offers each
  listed look as a card with a preview drawn from the look itself.
- **What is not a look stays out of the look system.** A layout change, such
  as a smaller approval card, applies to every look.

### Dots

- **Dots is Guilin karst over a river in fine dots** behind the conversation,
  bamboo after the last row of the side column, the Z drawn in dots, and soft
  panels without outlines.
- **Its pictures are drawn by Python scripts kept in the repository**, one
  shared dot renderer and one script for each picture (the landscape, the
  bamboo and the mark), linted with the rest of the repository's Python. Every
  random draw is kept in its order, including a few whose values the pictures
  no longer use, so the same seeds give the same pictures with NumPy 2.4.4,
  SciPy 1.17.1 and Pillow 12.2.0.
- **The pictures are small.** The day landscape is drawn without paper grain,
  since the app lays its own grain over the ground. The bamboo is drawn once
  per theme at full alpha, and its strength is the slot's opacity like every
  other picture's. The pictures ship as lossless WebP.
- **Words sit on a calm area, placed by where the words are.** Behind a
  conversation the calm area covers the reading column and 16 px either side,
  whatever the window's width (the column's width is a shared token, which
  the look's mask reads), then rises to the full picture over the next 160 px
  through eased steps, so neither end of the fade shows as an edge. The empty
  conversation's page centres its words above a composer whose height varies,
  so a mask over the pane cannot find them; the page shows the whole picture,
  and its words carry an oval veil of the ground's colour, drawn by the page
  under any look that sets a veil and faded over a wide blur. Every other page
  keeps an even trace.
- **The calm area does not grow with Vivid.** Behind words, Dots keeps the
  landscape at a fraction of its opacity. That fraction is divided by the
  strength when the strength is above Default, so Vivid strengthens the
  picture where there are no words and leaves the trace behind words as it is
  at Default; Subtle lowers both.
- **The top of the ground fades over the sky.** The mask takes a second layer
  that leaves a share of the picture at the top and all of it from 55% of the
  height down: 0.45 in the light theme, whose sky is a field of fine dots, and
  1 in the dark theme, whose sky is black with a few stars. The light
  landscape shows at 0.38 of its opacity, so Vivid gives 0.57.
- **The landscape blends with the ground**: it may only lighten the dark
  ground and only darken the light one, so a dot never covers the ground's own
  grain with a flat colour. The blend is a slot variable.
- **Dots repaints one theme token**: muted text in the light theme becomes
  `#585b61`, so it keeps 4.5:1 over the darkest dots of the light landscape.
- **Contrast behind words is measured in the installed app, with floors.**
  Each region where words sit is captured with the pictures and with only
  their slots emptied, in both themes and at every strength, at 1100 × 750.
  Muted text must keep WCAG AA (4.5:1) against the worst background pixel
  (the 99th percentile of lightness on dark, the 1st on light), and the
  pictures must keep at least 85 % of the text's contrast under the model of
  Scharff, Hill and Ahumada (1999). The bamboo is not measured: it stands
  after the last row and scrolls with the list, so no row is ever drawn over
  it.

## Why

The owner wants a choice of looks and of how strongly a look's pictures show,
and more looks later. A look built into the components, as pseudo-elements
with fixed masks, opacities from theme tokens and literal corner radii, makes
every new look edit every stylesheet again, with nothing to catch a look that
forgot one: an exploration of Dots built that way was about 340 lines of
overrides with 114 `!important` rules, reaching components through class-name
matches. Fixed slots and variables make a look a list of values, and the
theme check holds every look to the same set, so a missing value fails the
gate rather than painting nothing.

The radius scale keeps Ink's values step for step, which makes it longer than
a designed one would be: nothing visible changed under Ink when it was
introduced, and every catalogue entry was drawn before and after to hold that.

The fallback variables keep each part's look-independent value in the part,
where a reader looks for it, instead of copying every value into each look,
where it would drift. Keeping Dots' generators in the repository lets the
pictures be redrawn and changed, and keeping only what produces what ships
keeps them readable.

A calm band set straight to the full picture read as a rectangle laid over the
landscape, and one set in shares of the pane left muted text over the reading
column's edges at 4.33:1 at Default and 3.98:1 at Vivid in the light theme at
1100 px. At Vivid the light sky's fine dots read as noise behind the top of
the page.

Measured when the contrast floors were set:

| Region | Theme | Contrast kept (Subtle / Default / Vivid) | Muted text, lowest |
| --- | --- | --- | --- |
| Reading column | dark | 97.9 % / 89.2 % / 89.6 % | 5.98:1 |
| Reading column | light | 97.6 % / 90.1 % / 89.8 % | 4.78:1 |
| Empty conversation's words | dark | 98.0 % / 91.7 % / 91.5 % | 6.09:1 |
| Empty conversation's words | light | 97.3 % / 90.5 % / 90.6 % | 5.14:1 |
| List rows | both | 100 % at every strength | 4.85:1 |

The installed contrast check, with these floors, passes in both themes at
every strength with the calm area eased and the light landscape at 0.38.

## Rejected

- A pure package listing the looks: the list is ids, a default and strengths,
  a value set both sides spell alike, which belongs in the contract (ADR
  0002). Names and descriptions are wording, which the window owns.
- Overrides per component per look: every look would touch every stylesheet,
  and nothing would check that a look is complete.
- Applying the look from the first snapshot only: the window paints once
  before the core answers, so it would open in the default look and then
  change.
- Treating an unknown saved id as damaged settings: a look removed from the
  list would send a person to history recovery over a picture.
- A shorter radius scale with values rounded to its steps: the cleaner scale,
  but every rounded corner would move by a pixel or two under Ink.
- Strength as a separate value per slot: one multiplier keeps Subtle and Vivid
  meaning the same in every look.
- Each look repeating every part's value: every value would live twice, and a
  change to a part would have to be made in each look too.
- Keeping the picture scripts outside the repository: the pictures could not
  be redrawn from the repository, and their source would not be reviewed.
  Copying every exploration script as it was, patches included: most patch
  other scripts' source or the exploration's CSS, and none is needed to draw
  what ships.
- Lossy WebP: it blurs the 3 px dots, a mean error of four grey levels and up
  to sixty-nine on the day landscape.
- A 256-colour palette: without the baked grain, lossless WebP is smaller than
  the palette PNG and exact.
- A calm band set in shares of the pane, or stopping straight at the full
  picture: the first leaves muted text below its floor at the column's edges,
  the second reads as a rectangle.
- Measuring Dots against Neutral: the comparison counts Dots' own parts, its
  dotted rules and row fills, as picture, and so measures them instead of the
  landscape.

## Assumptions

- Every place a look draws is one of the slots. A look that needs another
  place adds a slot, and every look then fills it or leaves it empty.
- Opacity scaled by 1.5 keeps text readable over every look's pictures, as
  measured for Ink and Dots in both themes. A look whose pictures sit behind
  words needs a calm area that does not scale.
- A query parameter is read before the first paint, and the window is shown
  only once it has painted.
- The look's pictures are small enough to load with the page: the largest is
  shrunk before it ships.
- The adapting luminance of the contrast model is the mean of the region
  without its picture, in both themes. The study's backgrounds were light; on
  a dark theme the eye also adapts to text and panels, so this is chosen, not
  taken from the study.
- The 85 % floor leaves about five points below the lowest measurement for
  differences in how another machine renders and scales the window.
- `initial` on a custom property makes `var()` use its fallback, in the
  Chromium Electron ships.
- A grain of ±1.8 grey levels, shown at under half opacity, is not seen
  against the app's own grain.
- The window composites a mask of two layers intersected, which Electron's
  Chromium has supported since version 120.
