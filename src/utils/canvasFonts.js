/*
  Font stacks for anything that draws to a <canvas>.

  Everywhere else in the app fonts come from CSS custom properties -- var(--font-mono),
  var(--font-sans). Canvas cannot use those. Chart.js takes the `family` you give it and
  writes it straight into ctx.font, and the Canvas 2D context resolves nothing: it parses
  the string as a CSS font shorthand, and a custom property is not a valid font family
  name there. The assignment is rejected silently and ctx.font keeps its previous value,
  which for a fresh context is the spec default of "10px sans-serif".

  Verified in the browser:

    ctx.font = "12px var(--font-mono)"   -> "10px sans-serif"     (rejected)
    ctx.font = "12px 'IBM Plex Mono'"    -> "12px IBM Plex Mono"  (accepted)

  So PriceChart's axis labels were rendering in the canvas default while every number
  around them was monospaced -- one of the screens where the substitution visibly did not
  happen. These constants are the literal family names the @font-face rules in index.css
  declare, kept here so canvas consumers have one obvious place to reach for and nobody
  reintroduces a var() that fails without an error.

  Keep in sync with --font-mono / --font-sans in src/index.css.
*/

export const CANVAS_FONT_MONO = "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace";

export const CANVAS_FONT_SANS = "'PublicSansWithMono', 'Public Sans', system-ui, -apple-system, sans-serif";
