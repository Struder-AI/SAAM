# Orbital wall implementation

The former fitted-sleeve/contact strategy is retired for new patterned walls.
Its geometry utilities may remain in the runtime for existing recipes and other
consumers; do not route orbital work through them.

`orbit.mjs` consumes an already calculated CCW world-XYZ primary spiral. It
accumulates arc length, evaluates a sine/cosine orbit in the local XY tangent /
inward-normal frame, and retains the primary Z. Pitch is an explicit function
of amplitude and nominal overlap. No contact or tangency solve occurs.
Geometry is independent of traversal speed. Input points are not mutated.

`build-orbit-bundle.mjs` is the SAAM 0.3.0 Slice/Trace adapter. Geometry queries,
contour correspondence, Slice defaults, Trace assignments and bundle persistence
remain owned by maintained SAAM APIs loaded from the supplied root. It obtains
original section contours once per layer station, constructs a primary spiral,
then applies the modulation and splits output into connected ordered courses.
It creates a new bundle and preserves the source. Read SKILL.md for options,
limits, memory requirements and actual verification evidence.

Keep this computation deterministic and script driven. Do not add fit/fidelity,
coverage, prior-layer support or sharp-corner repair optimizations. Distortion is
part of the requested behavior. Optional width profiles adjust amplitude/pitch;
they must not require a different surface pipeline. Future streaming or compact
representation changes belong to their owning shared contracts, not copied
export/render implementations in this skill.

`preview-orbit-bundle.mjs` forces preview mode in the same adapter. It queries
one original section at the geometry's middle Z, uses the identical orbit module,
and emits one constant-Z Trace course without a base. Keep preview parameters
identical to the full job. Maker workflow shows this real workbench preview before
full generation; never substitute SVG or rebuild a fitted surface for it.

### Toolpath confirmation step

Before presenting the mid-height one-circuit Workbench preview, announce **toolpath confirmation step** and say: **please inspect this one layer and let me know if the density of the wall toolpath is what you are looking for**. Explain that this is a parameter preview, then prompt: **If you are happy with the toolpath preview, let me know and I will generate the full toolpath for your part.** Wait for the user’s acceptance before generating the complete part.

Default turning compensation uses the actual XY distance traveled by the inward orbit center and the signed turn of the primary tangent frame:
`deltaPhase = orbitDirection * 2*pi * deltaCenterDistance / pitch - deltaFrameAngle`.
`orbitDirection` is +1 for counterclockwise orbit and -1 for clockwise orbit; primary contour travel stays unchanged. `turnCompensation` defaults to true. Amplitude stays fixed. This is a local linear-time calculation, with no contact solver, surface fitting, corner repair, or guarantee of uniform overlap on arbitrary geometry. Test both directions in real Workbench previews before accepting it.
