# The app's look

How Zhiyin looks in its window: the name, the mark, type, colour and the
looks a person chooses between. The website and the videos share the name and
the mark and add motion and sound of their own, described in
[brand-motion.md](brand-motion.md).

## The name

知音 (*zhīyīn*) comes from the story of Bo Ya and Zhong Ziqi. When Bo Ya's
music turned to high mountains, Zhong Ziqi heard the mountains; when it turned
to flowing water, he heard the river. The word means a friend who understands
what you mean. Mountains, water, mist and clouds are therefore the brand's
whole vocabulary of images. Nothing else is drawn for decoration.

## The mark and the name in the window

- **The mark** is a single calligraphic Z painted with a brush. Its stroke
  crosses itself in the middle, leaving two thin slits; they are part of the
  mark. It is drawn in the ink colour on the ground, never boxed or badged.
  Each look draws it in its own way (below).
- **The name** beside the mark is ZHIYIN in capitals, in the interface face,
  tracked a little apart.
- There are no seals, stamps or red badges anywhere.

## Ground, ink and colour

The window has a dark and a light theme, which follow Windows unless the
person chooses one under **Settings**, **Appearance**. Every colour is a
token defined once for each theme, and the gate's theme check holds text to
4.5:1 contrast on every ground and chart marks to 3:1.

- **The ground** is paper with a fine grain: warm and dark (`#1b1918`) in
  the dark theme, warm and pale (`#eeeae4`) in the light one. Everything
  rests on it.
- **The ink** is what a look's landscape is painted in: pale (`#e8e2d6`) on
  the dark ground, the reverse of a scroll, and dark (`#1b1e25`) on the
  light ground. Text is a warm white on dark and a warm black on light, with
  softer and muted tones for what is secondary.
- **Red** is for what a person acts on, and for work in progress: the
  primary button, Allow, a running step. It is never ornament: no red
  headings, no red halves of phrases, no red marks or seals. A brighter red
  is used for text and lines, a deeper one for filled controls, so white on
  it stays legible.

## Type

The display face is Bahnschrift, for titles. The body is set in Segoe UI
Variable, and data in Cascadia Mono. Headings
say plainly what follows; they carry no slogan.

## The looks

A look is the branding the window wears: the pictures it draws on the ground
and how the mark is drawn. A person chooses one under **Settings**, **Look**,
or on the first screen, and how strongly its pictures show under
**Strength** (Subtle, Default or Vivid). Every look has a dark and a light
version, one for each theme.

- **Ink** is the brand as painted, and the look a new profile starts in. A
  landscape in one ink: mountains along the foot of the conversation with
  mist drifting between them, water after the last row of the side column
  with light passing slowly over it, far ranges at the foot of every other
  page and clouds behind its title. The mark is painted with a brush, large
  and on its own on the new-task page. On the dark ground the ink is pale; on
  the light ground it is dark and the mist shows more.
- **Dots** is the same story told in another hand: karst peaks over a river
  behind the conversation and bamboo after the last row of the side column,
  drawn in fine dots, and the mark drawn in dots too. Its panels lose their
  outlines and become soft, rounded patches of ground; checks are rings of
  dots and the step track is a row of them. Words always sit on a calm area
  where the landscape is faint. On the dark ground the dots only lighten
  it, on the light ground they only darken it, so the paper's grain still
  shows.
- **Neutral** is the grained ground with nothing drawn on it, for a person
  who wants no pictures. The mark sits in a disc with rings on the new-task
  page.

What a look may change, and what it may not (ADR 0028):

- It may fill the fixed places where pictures go (the ground behind the
  conversation, a band drifting over it, the foot of the side column, the
  foot of every other page, behind a page's title, and the marks), or leave
  any of them empty. It must set every one; the theme check fails a look
  that leaves one out.
- It may repaint theme tokens, colours and corner radii included, in both
  themes, held to the same contrast floors as the theme. Dots darkens muted
  text in the light theme so it keeps 4.5:1 over its darkest dots.
- It may dress the parts that read a look variable, such as panels, checks,
  the step track, the person's message and the list's labels; a look that
  keeps a part as it is says so.
- It may not change layout, wording or behaviour. Strength scales only the
  pictures, never the marks, and the calm area behind words does not grow
  with Vivid.

ADR 0028 say how Dots' pictures are drawn and how its calm area
is measured.
