# Heat-set inserts: development

Add insert families to [catalog.mjs](scripts/catalog.mjs) with manufacturer
provenance. The bore detail is local to the shared planar producer: layer heights,
bead volumes, material ownership, travel, composition, machine output and Studio
are the shared ones, and shared scanline fill follows each tapered fin footprint.

## Development example

```sh
node skills/heat-set-inserts/scripts/demo.mjs Prints/development/heat-set-example
node studio/server.mjs Prints/development/heat-set-example
```

It refuses an existing bundle and makes a 54 × 32 × 12 mm block with an M3
Series 29 long hole and a 4-40 Series 19 short hole, two perimeters, 15% infill
and solid top and bottom, then generates a development toolpath without
approvals. A middle bore layer shows the six loops and fins before the top covers them.
