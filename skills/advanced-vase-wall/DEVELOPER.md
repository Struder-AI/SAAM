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
