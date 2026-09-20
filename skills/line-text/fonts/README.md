# Bundled stroke fonts

Single-line (stroke) fonts store each letter as centerline paths instead of a
filled outline. The files here are **unmodified** copies of SVG fonts; the
[catalog](../scripts/catalog.mjs) owns their ids, tags and summaries, and
[manifest.json](manifest.json) owns what is measured from them (regenerate with
`node skills/line-text/scripts/build-manifest.mjs`; a test fails when a font
file and its manifest entry disagree).

| Folder | Source | Terms |
|---|---|---|
| `hershey/` | [Evil Mad Scientist SVG fonts](https://gitlab.com/oskay/svg-fonts), from the Hershey vector fonts | Free for any use provided the acknowledgement below is distributed with the font data. |
| `ems/` | The same repository: EMS fonts derived from open Google fonts | SIL Open Font License 1.1. Each file names its source font, designer and license in its `<metadata>`; [OFL.txt](ems/OFL.txt) is the license text as that repository ships it. |
| `relief/` | [Relief SingleLine](https://github.com/isdat-type/Relief-SingleLine) by Tanguy Vanlaeys | SIL Open Font License 1.1; [OFL.txt](relief/OFL.txt). |

## Hershey acknowledgement

Carried in the `<metadata>` of each Hershey file, and required to travel with the data:

- The Hershey Fonts were originally created by Dr. A. V. Hershey while working at
  the U. S. National Bureau of Standards.
- The format of the font data in this distribution was originally created by
  James Hurt, Cognition, Inc., 900 Technology Park Drive, Billerica, MA 01821.

The data may be converted to other formats except the U.S. NTIS point-per-eight-bytes
format. These SVG files are not in that format.

Keep the files unmodified. If a font is added, record its source and license here,
add it to the catalog, and rebuild the manifest. Do not add a font whose license
forbids redistribution with the repository.
