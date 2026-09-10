# Spiral Lip Geometry

## Robot-confirmed baseline

- Layer height: `0.70 mm`
- Measured bead width: `0.83 mm`
- Perimeter center spacing: `0.679779 mm`
- Print speed: `3`
- CP: `1`
- A 1 mm clipped-corner transition printed without unusual stringing.
- A 1 mm cutback overfilled a four-path lip because it produced only
  `0.433 mm` normal path spacing.
- Extra manual cooling improved the rim.
- A centered `4 -> 3 -> 2` crown printed successfully.

## Width and path count

For bead width `b`, path spacing `s`, and `N` paths:

```text
physical_width(N) = b + (N - 1) s
N = nearest_integer((requested_width - b) / s) + 1
```

Clamp `N` to at least 2 for a lip. Report the achieved width rather than
claiming an unrepresentable exact width.

Example with `b=0.83`, `s=0.679779`, and requested width `3.0`:

```text
N = 4
achieved width = 0.83 + 3(0.679779) = 2.869337 mm
```

## Corner-support conversion

For a regular hex, edge cutback `c` produces normal midpoint inset:

```text
normal_spacing = c cos(30 degrees) / 2
c = 2s / cos(30 degrees)
```

For `s=0.679779`, use:

```text
c = 1.56969 mm
```

Use `1.57 mm` in Lua unless tighter precision is useful.

## Ramp schedule

Let `P1` be the frozen outside path. Derive `P2...PN` recursively from clipped
chord midpoints.

For maximum count `N`:

```text
P1 full
clip(P1)
P1 + clip(P2)
P1 + P2 + clip(P3)
...
P1 ... PN full
P1 ... PN full  (default consolidation repeat)
```

The clipped innermost path counts as that layer's innermost perimeter.

## Circular crown

Let achieved width be `W` and circle radius `R=W/2`. At crown height `y`
above the widest layer, the ideal chord width is:

```text
chord(y) = 2 sqrt(R^2 - y^2)
```

Sample at `y = k * layer_height`. Convert each chord to the nearest realizable
physical path width. Center each narrower chord over the widest layer. The
count may drop by more than one because contraction does not create an
unsupported overhang. Stop at two paths by default.

For each crown layer with `n` paths, center it on the maximum lip midline:

```text
midline = -(N - 1)s/2
outermost_offset(n) = midline + (n - 1)s/2
offset(j) = outermost_offset(n) - j s
```

For `N=4`, this yields:

```text
4 paths:  0, -s, -2s, -3s
3 paths: -0.5s, -1.5s, -2.5s
2 paths: -s, -2s
```

This centers the crown instead of creating an inner-only chamfer.
