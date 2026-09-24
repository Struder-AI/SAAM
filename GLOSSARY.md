# SAAM glossary

Terms whose SAAM meaning is not the everyday one.

| Term | Meaning |
|---|---|
| Print bundle | The local folder for one part: its geometry, recipe, review records and, once generated, the checked machine program. The physical result is the *printed part*. |
| Recipe | The choices that make a print bundle's part: geometry, skills and their settings, machine and setup. Stored as `plan.json`. |
| Confirmation | The person's one final approval of the current settings and exact toolpath together, in Studio, before export. Geometry review is not a gate. |
| SAAMpath | SAAM's one machine-independent toolpath: moves with deposition volume, speed and context, plus process actions. The composer builds it from skill results; each machine's exporter translates it into that machine's program. It is not saved in the print bundle. |
| Toolpath skill | A skill whose result is deposition: strokes the composer combines with other toolpath skills' results into one SAAMpath. |
| Geometry skill | A skill that makes, fetches or changes the part's geometry before any toolpath exists. Each change is a new geometry revision. |
| Sleeve | A surface that is periodic in one direction, closing on a seam, and open in the other: the side of a tube. Paths are laid out on it; it is never deposited. |
| Tile | One continuous curve drawn in one cell of a sleeve's unwrapped strip, repeated to make a pattern. |
| Course | One full circuit of tiles around a sleeve. |
| Pattern | The complete arrangement laid on a sleeve: courses of a repeated tile, or authored paths. Changing the tile changes the pattern. |
