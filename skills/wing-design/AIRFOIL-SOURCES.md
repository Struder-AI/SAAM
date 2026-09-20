# Airfoil sources and selection

Source assessment for the proposed wing workspace. This is research and a proposed
integration approach, not an implemented importer, search index or analysis tool.

## Recommended foundation

Use **UIUC coordinates as the primary geometry source**, joined to separately
identified performance evidence. Build SAAM's own search and candidate cards over
that index. Use BigFoil as a supplementary browsing and comparison reference.

| Source | Verified offering | Proposed role |
|---|---|---|
| [UIUC Airfoil Coordinates Database](https://m-selig.ae.illinois.edu/ads/coord_database.html) | Approximately 1,650 profiles, named coordinate files, descriptive entries and a standard Selig-format archive. | Primary geometry and provenance. Its alphabetical index needs a SAAM search/filter layer. |
| [UIUC Low-Speed Airfoil Test data](https://m-selig.ae.illinois.edu/pd.html) | Downloadable wind-tunnel datasets, grouped by published volume. | Measured performance where the exact profile and conditions match. Coverage is a subset of the geometry library. |
| [BigFoil](https://bigfoil.com/) | Searchable catalog listing 6,422 airfoils at inspection; labels distinguish wind-tunnel, XFOIL, JavaFoil and NeuralFoil sources. | Useful browser today and supplementary evidence discovery. No stable public API or bulk reuse agreement was established in this research. |
| [Foil.tools search](https://foil.tools/search) | Advertises fuzzy name search, thickness/camber filters, polars and DAT/DXF exports; says geometry is represented with CST parameters. | Useful interaction reference. Any reconstructed geometry needs comparison with the original coordinates before adoption. API, data provenance and reuse terms were not verified. |

AirfoilTools was also investigated, but its search page returned a gateway error
during inspection. Do not make it the sole required source on that evidence.

For a concrete comparison record, [BigFoil's Clark Y page](https://bigfoil.com/afa015f1-ed85-42c4-84ee-3490b2b87f76_info.php)
lists 11.7% maximum thickness, 3.4% maximum camber, UIUC coordinates, UIUC Volume 3
wind-tunnel data and separate prediction sources. It is a source example, not a
recommendation for an unspecified aircraft.

## Coordinate ingestion proposal

Keep the original file, source URL, profile/variant name and content hash. Parse
coordinates into a normalized section without silently smoothing or replacing
the source shape. UIUC documents comments beginning with `#` and a standard
archive ordered from the upper trailing edge around the nose to the lower
trailing edge. The individual [Clark Y file](https://m-selig.ae.illinois.edu/ads/coord/clarky.dat)
instead contains a point-count header and separate upper/lower blocks. Support
both layouts explicitly; counts are not coordinates.

The importer should detect malformed points and ambiguous ordering, distinguish
a repeated leading edge from a finite trailing-edge gap, and preserve original
and smoothed variants as distinct records. Scaling to chord and lofting between
wing stations are downstream construction steps. Any fitting, resampling or
printable trailing-edge modification should retain its parameters and report
deviation from the source. Modified geometry must not silently inherit the
original section's aerodynamic results.

## Conversation before ranking

Establish application and priorities, conventional tail versus tailless layout,
approximate flight mass, wing size/chord and speed range. Ask incrementally and
use explicit provisional ranges where the person is still exploring.

Estimate section Reynolds numbers using `Re = V * chord / kinematic viscosity`,
including root and tip and slow/cruise conditions. Use consistent SI units and
record the atmospheric assumption. [NASA's Reynolds-number explanation](https://www.grc.nasa.gov/www/k-12/airplane/reynolds.html)
gives the physical basis. Wing lift demand in steady level flight can be estimated
with `CL = 2 * mass * g / (density * speed² * wing area)` from
[NASA's lift equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/lift-equation/).
That whole-wing value is not the local section lift coefficient; local loading
requires a wing model.

Prefer measured evidence at applicable conditions. Numerical results can fill
gaps but need solver and condition labels. [XFOIL's primary documentation](https://web.mit.edu/drela/Public/web/xfoil/xfoil_doc.txt)
describes Reynolds/Mach-dependent polars, transition assumptions and limitations
around strong separation, low Reynolds numbers and inadequate resolution. Do
not interpret the highest computed lift point as a demonstrated stall limit.
Printed surface finish and a modified trailing edge can change behavior; a
single transition setting does not certify the effect of print roughness.

For a tailless aircraft, moment and trim deserve explicit attention. The designer's
[MH flying-wing guidance](https://www.mh-aerotools.de/airfoils/foil_flyingwings.htm)
connects section moment with sweep and twist choices. A section's favorable
lift/drag ratio alone cannot establish a balanced or stable aircraft.

## Proposed scrollable candidate cards

Begin with a small relevant shortlist; retain search of the full source index.
Explain each inclusion and its main tradeoff rather than assigning an opaque
universal suitability score.

| Display | Purpose |
|---|---|
| Name, variant, source and section thumbnail | Recognize and inspect the actual geometry. |
| Thickness and camber percentages, with peak positions | Compare shape; explain what these mean in plain language. |
| Thickness in mm at the selected chord and spar/hardware locations | Relate the section to construction space. Account for skin and clearance before claiming usable space. |
| Available Reynolds range and selected comparison condition | Show whether evidence covers this application. |
| Drag and section lift/drag at the relevant lift range | Compare performance at matched conditions, rather than unrelated peak values. |
| Pitching moment and available high-lift/stall evidence | Explain trim implications and slow-flight tradeoffs. |
| Measured / predicted / unavailable badge | Make evidence quality and gaps visible. |
| Short reason to consider it, main compromise and source link | Support the conversation and let the user inspect the basis. |

Comparison plots should show lift versus angle, drag versus lift and pitching
moment where data exist. Retain Reynolds number, Mach number, transition/trip
settings, flap configuration, geometry identity and test/solver provenance with
each curve. Do not silently mix different sources or extrapolate absent values.
Selecting a candidate proposes a design change; scrolling or hovering should
not overwrite the current wing.

## Data reuse boundary

UIUC's performance-data page specifies attribution, free redistribution of source
data, no additional charge for the data beyond reproduction/distribution, and
inclusion of its license, copyright notice and manifesto when distributing it.
Carry those materials with any imported dataset. Do not assume these terms also
license every coordinate file or another site's derived dataset. Preserve
per-source notices and resolve redistribution terms before bundling a catalog.
This research has not copied a bulk dataset or established a provider API.
