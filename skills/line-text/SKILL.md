---
name: line-text
description: Print a word as centerline strokes, one bead per stroke, choosing the construction from the requested size. Small lettering uses one thin bead, larger lettering one wider bead, and the largest uses beads side by side. Picks from bundled single-line and handwriting-script fonts and prints through line-network; not a filled-outline text solid.
metadata:
  saam-kind: task
---

# Line text

Use this preparation skill when a person wants a word written as beads, not
filled letters: signs, labels, signatures and handwriting whose stroke *is* the
part. It compiles the word into [line-network](../line-network/SKILL.md)
strokes, so validation, tool bounds, generation, Studio review and export are the
existing line-network path. For raised or recessed lettering on a body, or a
solid letter shape, use [text](../text/SKILL.md) instead: that skill needs an
outline font and produces a mesh.

## Describe the text, not the construction

Say what the person wants: the words, how tall, how heavy, what style. The skill
decides how to build it from the beads the process allows:

| Wanted stroke | Construction |
|---|---|
| Thinner than the thinnest bead | `fine`: one thinnest bead, heavier than asked. |
| Fits one bead | `single-bead`: one bead, sized to the stroke. |
| Wider than the widest bead | `parallel`: the fewest beads side by side that each stay within the widest bead, sized so the row adds up to the wanted stroke. |

A stroke up to 25% wider than the widest bead still prints as one widest bead;
a second bead doubles the work for a small gain. Height is the measured capital
height of the chosen font, so 6 mm text is the same letter height in every face.
Weight is a fraction of that height (`light` 0.05, `regular` 0.08, `bold` 0.13, or
an explicit `stemRatio`); these are authoring defaults to tune with physical
trials, not typographic standards.

The bead range comes from the machine's own line-width limits: ordinary
deposition (about 0.3–0.8 mm) or `--experimental` big-bead deposition (up to 2 mm,
layers up to 1 mm). With the ordinary range, 6 mm regular text is one 0.48 mm
bead and text above about 13 mm needs parallel beads; with 2 mm beads a single
bead carries text to about 31 mm before parallel beads take over.

### Parallel beads

A stroke `n` beads wide is built as offset curves of the centerline: each pair of
beads is the two sides of the stroke, closed around the ends and joins into one
loop, and an odd count keeps the centerline bead. Junctions therefore print as
one continuous bead instead of crossing beads. This is the same result a slicer's
perimeters give a thick letter, made from the centerline. It is experimental:
physical joins and end shapes are unvalidated.

## Bead width, flow and speed

The plan decides **width**, from the nozzle: the widest bead is the tool's line-width
limit (0.75 to 2 times the nozzle in ordinary deposition, or the tool's experimental
range, 0.3 to 2 mm on the H2D). It does not decide **flow or speed**, which come from
the process, and it does not use them to choose between one bead and several.

- Material per millimetre is bead width times layer height, so the layer height you
  choose sets the bead's cross-section along with its width.
- The path builder slows any move whose flow would exceed `maxFlowMm3S`, so a bead
  prints at the lower of `planarSpeedMmS` and `maxFlowMm3S / (width x layer)`.
- `maxFlowMm3S` defaults to 4 mm3/s, a conservative default that suits fine beads and
  crawls on wide ones: a 1.92 mm bead at 1 mm layers runs at about 2 mm/s (4.6 minutes
  for a 24 mm "SAAM"); at 30 mm3/s, the H2D's experimental limit, it runs at about
  16 mm/s (0.7 minutes) from the same toolpath. The command prints this as `deposition`
  (effective speed, what limits it, print time) and warns below 5 mm/s. It never raises
  the flow limit itself: choose it with `--max-flow` and `--speed`, within the machine's
  limit, as a process decision under the [standard parameter policy](../../MAKERS.md#standard-parameter-policy).
- Flow never argues for doubling up: splitting a stroke across beads moves the same
  volume, so it takes the same time at the flow limit. Parallel beads are chosen
  because one bead cannot be as wide as the wanted stroke, and for no other reason.
  Flow and speed change how long a bead takes, and do not change the width it can have.

## Choosing a font

Fonts are chosen by looking, with measurement narrowing the choice. Generate an
image of the person's word at their size and show it in the chat; there is no
Studio font picker. Each candidate is numbered so the person can answer with a
number:

```sh
node skills/line-text/scripts/specimen.mjs "Hello" --height 20 --range 0.3,2 --intent script --top 6 --png specimen.png
```

Attach the PNG with the client's image or file display. Only fonts that can hold
the word at this size are drawn, best first, and each is labeled with its
construction (bead count and width, and "weight reduced" where the font could not
hold the requested weight). The command prints the numbered candidates as JSON,
with the font ids to use and how many fonts were left out, so map the person's
choice to `--font`. Beads are drawn at true width, up to 10 px per mm and scaled
down to fit 1400 × 2400 px, so a very large sign shrinks and thin beads look faint.
`--out file.svg` writes a physical-scale SVG (1 unit = 1 mm) instead or as well.

`--intent` ranks by style tags (`sans`, `label`, `technical`, `handwriting`,
`casual`, `script`, `formal`, `joined`, `signature`, `calligraphic`); ties keep
catalog order, which lists the best-spaced sans first.

The [catalog](scripts/catalog.mjs) lists the eleven bundled faces and their
[manifest](fonts/manifest.json) holds what is measured from each: character
coverage, strokes per glyph, retraced strokes, how often adjacent letters join,
and **fusion width**, the stroke width (as a fraction of cap height) at which
counters fill in or strokes fuse, at the tightest tenth of glyphs. Hershey Sans,
EMS Tech, Relief and Casual Hand hold 16–23% of cap height; EMS Invite 12%; EMS
Readability 8%; the looped scripts (Allure, Swiss, Brush, Society, Hershey Script)
only 3–4%. A looped script therefore cannot be made heavy at any size, and the
plan reduces its weight rather than let letters fill in. Where a font cannot hold even the thinnest bead
at the requested height the plan reports `feasible: false` with the smallest
height it needs. Then choose a larger size, a thinner bead or a roomier font.

Fonts are unmodified SVG stroke fonts; see [their provenance and terms](fonts/README.md).
Other fonts, including outline handwriting fonts, are not converted: skeletonizing
an outline produces spurs and false loops that need hand cleanup. A character the
chosen font lacks is an error, never a silent substitute.

## Make the print

```sh
node core/print/cli.mjs init Prints/my-sign --machine bambu-h2d
node skills/line-text/scripts/line-text.mjs "SAAM" --height 24 --intent label \
  --experimental --layers 2 --layer-mm 1 --max-flow 30 --place 40,40 --out Prints/my-sign-patch.json
node core/print/cli.mjs adjust Prints/my-sign Prints/my-sign-patch.json
```

The command prints the chosen font, the plan (regime, bead width, parallel count,
requested and achieved stroke, warnings), the extent in mm and the font ranking.
The patch turns on `line-network`, turns every other pattern off, sets the bead
width and, with `--layer-mm`, `--speed` and `--max-flow`, the layer heights, planar speed and flow limit. `--experimental` is needed for
beads wider than the ordinary limit. Then generate and review in Studio through
the [shared print tools](../../core/print/USAGE.md); nothing is approved.

Text is placed so the outer edge of its ink is at the local origin; `--place X,Y`
sets where that lands on the bed, and placed text must stay inside the tool's
bounds or generation rejects it. `layers` (default 2) is the number of courses,
so it sets how tall the letters stand.

Scripts can call `lineText({font: loadFont(id), text, heightMm, weight, beadRangeMm, layers})`
from [compile.mjs](scripts/compile.mjs), which returns `lineNetwork` settings, the
`process.lineWidthMm` to use, the plan and a report.

| Option | Meaning / default |
|---|---|
| `heightMm` | Capital height, measured from the font. |
| `weight`, `stemRatio` | `regular`; or an explicit stroke/height ratio. |
| `beadRangeMm` | `[thinnest, widest]` bead; from the machine limits in the CLI. |
| `layers` | Courses, 2. |
| `letterSpacingMm`, `align`, `\n` | 0, `left`, new lines at 1.4 × height. |
| `spacingFactor` | Parallel bead pitch as a multiple of bead width, 1. |
| `chain` | Join strokes whose ends meet (joined scripts print as one bead), on. |
| `onInfeasible` | `reduce` lowers the weight until counters stay open; `error` refuses. |

## What the compiler adds

- **Junction snapping.** `line-network` does not infer junctions, so an endpoint
  the font leaves short of another stroke of its glyph is extended onto it. Only
  gaps up to 0.03 of cap height close: across the bundled fonts, gaps are either
  exact touches or under 0.03, then none until about 0.04.
- **Marks a bead would cover.** A closed loop no wider than two beads (Hershey's
  period and i-dot are 0.09 of cap height) becomes a dot; a dot already inside a
  neighbor's bead is dropped. A dot is a bead one bead-width long.

## Limits

- Software only: no part from this skill has been printed. Stroke weights,
  clearances and the 25% tolerance are unvalidated defaults; fusion width is a
  geometric legibility test, not a print-quality guarantee. Bead overlap where
  strokes cross, dot shapes and parallel-bead ends need physical trials.
- Curves are as smooth as the source vertices allow; several fonts are coarse
  polylines and show facets at large sizes. No smoothing is applied.
- Only Relief SingleLine carries kerning. Other fonts space by advance widths.
- Strokes are ordered as the font writes them, with no travel optimization, and
  nothing checks whether a placed sign is structurally self-supporting.
- Scripts that were designed for pen plotters retrace no strokes here (measured),
  but their letters cross themselves in loops; the crossings deposit over each
  other and need the physical check line-network already asks for.
- No automatic bounds fit: choose a height and `--place` that keep the text on the bed.

## Verify

`node --test skills/line-text/tests/*.test.mjs` covers the parser, layout,
measurement, size-driven planning, snapping, parallel beads and an end-to-end run
through line-network validation and path generation. After adding a font run
`node skills/line-text/scripts/build-manifest.mjs`.
