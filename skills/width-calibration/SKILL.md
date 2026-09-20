---
name: width-calibration
description: Print a small calibration ladder to check whether commanded bead widths come out as expected. A closed low frame ties together upright walls commanded at different widths, each on its own layer height, printed finest first, with 5 mm centerline spacing so calipers can measure each wall. Use before trusting a commanded width in line-network or line-text.
metadata:
  saam-kind: task
---

# Width calibration

Use this preparation skill to find out whether the bead width SAAM commands is the
width the printer produces, on a given machine, nozzle, material and layer height.
It builds a small test object through [line-network](../line-network/SKILL.md); the
person measures it with calipers and compares.

## The object

Upright test walls, 3 mm tall and 20 mm long, spaced 15 mm **centerline to centerline**
(`--pitch` changes it), held together by two low rails across their ends. The rails are 2
courses tall at the nominal process width and layer height, run from the first wall to the
last, and sit on the wall ends' own footprint, so the piece is **no wider or longer than
its walls**: the outer walls are its sides, and nothing extends past them. The default
ladder is 0.25, 0.5, 1, 1.5, 2 and 2.5 mm commanded widths; the walls that print on the H2D
(0.5 to 2 mm) make a 46.25 × 20 mm piece using about 0.4 g of PLA. The walls are not
labeled; they run in increasing width. The faces of neighboring walls are at least 12.75 mm
apart.

Each wall prints on **its own layer grid**. A wider bead wants a taller layer, so a
wall's layer height is a fixed ratio of its commanded width, by default 1:2
(`--ratio 0.5`): 0.125 mm layers for 0.25 mm, up to 1.25 mm for 2.5 mm. That ratio is
a starting point to test, not an established optimum. A wall is as many whole courses
as fit under 3 mm, so the 2.5 mm wall stands 2.5 mm. Courses print by ascending height,
and where several share a height the finest goes first: the thinnest wall is built up
several times before the thickest gets its one course. See
[per-network layer grids](../line-network/SKILL.md#networks-on-their-own-layer-grids).

## Make it

```sh
node core/print/cli.mjs init Prints/development/width-ladder --machine bambu-h2d
node skills/width-calibration/scripts/ladder.mjs --machine bambu-h2d --place 100,100 --out /tmp/ladder.json
node core/print/cli.mjs adjust Prints/development/width-ladder /tmp/ladder.json
node core/print/cli.mjs generate Prints/development/width-ladder
```

The command lists every wall with its layer height, course count, and whether the
machine's limits allow it. Options: `--widths 0.5,1,2`, `--ratio`, `--height` (3),
`--length` (20), `--pitch` (15), `--max-flow` and `--speed` for the process. Then review
in Studio through the [shared print tools](../../core/print/USAGE.md); nothing is
approved.

**Walls the limits refuse are left out, with the reason.** The width limits are 0.3 to
0.8 mm in ordinary deposition and 0.3 to 2 mm in experimental big-bead deposition, and
the layer limit is 0.3 or 1 mm. On the H2D the 0.25 and 2.5 mm walls are refused, and
the 1 to 2 mm walls need experimental deposition, which the command turns on when any
wall needs it. Testing outside the operating limits needs an explicit test-only override
that does not exist yet.

The default flow limit (4 mm3/s) keeps the wide walls slow, which is deliberate:
under-extrusion would otherwise shrink the beads being measured. The ladder takes about
two minutes.

## Measure it

Caliper each wall at mid-length and mid-height, away from the frame junctions and the
start of the bead, three readings per wall. Write them by commanded width:

```json
{"0.5": [0.55, 0.56, 0.55], "1": [1.10, 1.12, 1.11]}
```

```sh
node skills/width-calibration/scripts/ladder.mjs --machine bambu-h2d --measure readings.json
```

It reports each wall's mean, spread and error, a straight-line fit, and how well two
volume models explain the readings. SAAM computes bead volume as width times layer
height (a rectangle). A rounded bead of the same area is wider by about 0.21 times the
layer height, which at a 1:2 ratio is 10.7% at every width. Which model the readings
follow is the result. Typical calipers resolve about 0.02 mm, so the 0.5 mm wall's
predicted 0.05 mm difference is near their limit and the wider walls are clearer. A
thin wall can also be crushed by the jaws.

## Limits

- Software only: no part from this skill has been printed. Studio, the toolpath and the
  volumes are checked, but the width model is a prediction until measured.
- The result is a report; nothing is stored or applied yet. The measured mapping does not
  yet correct commanded widths in line-text.
- The print's stored geometry is the recipe's placeholder shape; line-network ignores it.
- Each wall has one layer height. Finding the best layer height for a width needs several
  per width, which this object does not do.

## A calibration article

The ladder is the accepted calibration article for commanded against actual bead width.
As people bring new printers, filaments and nozzles, their readings are meant to build up
into a record of commanded and actual width for each setup, so calibration improves over
time. No collection route or shared record exists yet; today a reading set is analyzed on
the spot and kept only in the conversation.
