# Bounded RC8 cladding dry run

This development utility extracts a selected sector of the first axial
shell from an existing circular-pipe recipe (72 degrees by default; up to 360). It calls the shared pipe-cladding
producer, keeps its track lattice and alternating direction, recentres the part
at Work 2 origin, and collapses only exactly collinear constant-posture vertical
samples. Front means -Y, cylinder axis +Z, base Z0. It generates no substrate,
other shells, rotary commands or extrusion IO.

Run from the repository root:

```sh
node tools/denso/create-cladding-dry-run.mjs <saved-plan.json> <new-output-directory> [sector-degrees]
```

Use 180 for the front half (-180 through 0 degrees), or 360 for all tracks,
starting at front -Y. Track order stays cyclic across the source seam. Boundary
tracks are included; 180 selects 75 of this recipe's 148 tracks. A full circle
visits each track once without duplicating the start or adding a closing return.

The command refuses an existing output directory. It saves the source recipe and
hash, selected tracks, generated motion, program hash and a PacAttri manifest
entry. It is separate from the production rotary exporter and has no approval or
hardware-execution path. It does not relax production setup validation.

The program uses the passing local setup: Tool 6 = P(155,0,35,0,90,0), Work 2,
P10 taught in those frames, Speed 50 and Accel 100,100. After a joint-space
approach at inherited P10 posture, it sets the actual cladding orientation at an
elevated point, approaches the first track and stops at every track/index endpoint.
It finishes at the last endpoint without a return or retreat. Tool +Z aims radially
inward and downward at the recipe's tilt; tool +Y retains the source tangent.
T2P(T(...,Fig(P10))) preserves the taught FIG while setting the complete path pose.
An unchanged FIG does not guarantee a reachable or collision-free path.

The initial approach is 10 mm radially outside the first track and 20 mm above
the pipe top. These are authored review coordinates, not a collision solution.
Compile and Teach Check the new orientation-changing source before execution.
The spiral only validated fixed-posture paths. Program-only USB staging should
add this separately named file and its manifest entry to the current working
controller-project template; do not restore stale calibration or old programs.
The utility neither writes USB nor manufactures a complete WINCAPS project.

DENSO command references (manufacturer manual mirror):

- [T coordinates and orient/approach vectors](http://eidtech.dyndns-at-work.com/support/RC8_Manual/000458.html).
- [Fig reads the taught figure](http://eidtech.dyndns-at-work.com/support/RC8_Manual/000261.html).
- [T2P preserves the input FIG](http://eidtech.dyndns-at-work.com/support/RC8_Manual/000255.html).

Nominal reach studies use the [Studio model](../../core/machine/README.md#denso-vs-068a4)
with an explicit right-angle tool transform. They do not establish controller
joint limits, calibrated FIG mapping, fixture clearance or manufacturing approval.

## Tube-first continuous variants

The selected recipe also contains a planar tube substrate. The local
create-tube-motion.mjs utility consumes the shared full-fill substrate operations
and emits ring motion. Its standalone output is an earlier staged candidate.
For the user's continuous-extrusion trial, create-continuous-pipe.mjs combines that
tube geometry with either selected cladding sector:

    node tools/denso/create-continuous-pipe.mjs <tube-motion-directory> <cladding-dry-run-directory> <new-output-directory>

This is deliberately bounded to the selected 16/18.4 mm by 12 mm substrate,
60 layers, three rings and the first 9.3 mm radius cladding shell. It refuses other
lattices instead of treating hard-coded controller loop constants as generic.
The tool rolls and tilts while moving around the final top ring; cladding starts
at the top, with track direction reversed for 180 degrees. Ring/layer/track links
are depositing moves. No lifts, dwells, process IO or rotary commands occur.
All intermediate targets pass (@P); the final endpoint stops (@E).

There is no automatic approach: the operator supplies the specified starting TCP
and orientation before the separate extrusion controller starts. The initial
orientation is explicit downward with tool +Y toward W2 +X, not P10's inherited
roll; only Fig(P10) is reused. The Studio study displays nominal deposition
intent, not commands for the separate extruder.
