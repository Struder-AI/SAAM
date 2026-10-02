# Light Switch Covers parameter contract

Status: broad workspace design specification. The first local prototype implements a subset; README.md owns current support. Reference
families and sources live in [RESEARCH.md](RESEARCH.md) and [catalog.json](catalog.json).

## Selection order

1. **Location:** country/territory (`US` default), optional subdivision, preferred display units, language and writing direction. Store all geometry in mm. Location filters suggestions; it never locks the user to a standard.
2. **Existing installation:** recessed in-wall box, surface rectangular box, surface square box, handy/utility box, proprietary surface carrier, or junction box. Identify manufacturer, series, model and revision where known.
3. **What is being made:** replacement decorative plate, decorative frame retaining the original carrier, or overlay around an existing cover. Record separately whether a part encloses wiring, retains a device, participates in grounding, or maintains an environmental barrier.
4. **Form factor:** box count/layout, switch count, aperture types and widths, attachment and rear clearance. Choose reference family or measured/custom.
5. **Labels and decoration:** per control, conversational editing, protected clearances and print treatment.
6. **Review:** geometry/fit review before proposing printing settings; shared SAAM confirmation of exact settings and toolpath before machine output.

A country selector must also offer “Other / measured cover.” Installation type
must include both recessed and surface-mounted square boxes. A recessed square
box with a mud/plaster ring may present an ordinary device mounting interface;
store the ring separately rather than guessing a square faceplate.

## Parameter list

| Group | Fields | Meaning / choices |
|---|---|---|
| Location | `country`, `subdivision`, `displayUnits`, `language`, `textDirection` | US default; inches or mm for display; ISO country code or custom location; labels can be multilingual. |
| Provenance | `familyId`, `manufacturer`, `series`, `model`, `revision`, `sourceUrls`, `measuredOn`, `fitStatus` | Separate published reference, measured, dry-fit checked and installed evidence; never infer fit from catalog inclusion. |
| Existing box | `installationType`, `boxShape`, `nominalDesignation`, `boxWidth`, `boxHeight`, `boxDepth`, `boxCornerRadius`, `boxPosition`, `wallPlane` | Nominal 4-inch/4-11/16-inch/4x2/4x4 labels are not exact cover dimensions. Include round, square, rectangular and custom. Box depth is informational unless it constrains this part. |
| Ring / surface rim | `ringModel`, `ringRise`, `ringOpening`, `rimProfile`, `lipDepth`, `rimClearance`, `conduitKeepouts` | Mud rings, raised industrial covers and proprietary surface boxes need their own rear interfaces. |
| Product role | `partRole`, `retainedOriginalParts`, `enclosesWiring`, `retainsDevices`, `groundingRole`, `environmentalRole` | Decorative frame/overlay and device-supporting enclosure cover are materially different parts. |
| Arrangement | `boxCount`, `rowCount`, `columnCount`, `positions[]`, `positionPitchX`, `positionPitchY`, `orientation` | Explicit coordinates permit uneven spacing and multiple rows. “Gang” is a regional term, not a globally reliable switch count. |
| Per-device identity | `devices[].id`, `kind`, `model`, `controlCount`, `moduleSpan`, `rotation` | Toggle, wide/narrow/split rocker, pushbutton, rotary/slider dimmer, timer, sensor, smart control, duplex outlet, GFCI/decorator outlet, round outlet, data/coax, blank, legacy/custom. A 3-way switch still normally has one actuator. |
| Per-opening geometry | `apertures[].deviceId`, `shape`, `center`, `width`, `height`, `diameter`, `cornerRadius`, `profile`, `rotation`, `clearance` | Rounded rectangle, circle, duplex compound profile, shaft hole, slot or custom contour; actual opening dimensions are independent of the visible actuator. Separate split-rocker control labels can share one opening. |
| Motion and access | `actuationKeepouts[]`, `fingerClearance`, `plugKeepouts[]`, `indicatorKeepouts[]`, `sensorKeepouts[]`, `ventilationKeepouts[]` | Check whole toggle/rocker motion, knob sweep, slider stroke, plug insertion and indicator/sensor access; not just static openings. |
| Plate outline | `width`, `height`, `outlineShape`, `cornerRadius`, `edgeMargins`, `coverageClass`, `coverageOverrides` | Standard/midway/oversize or custom; allow independent left/right/top/bottom margins, narrow trim-side edges, centered/off-center layouts, rounded or custom outlines. Enlarging the outside does not widen device openings. |
| Plate section | `faceThickness`, `overallDepth`, `edgeProfile`, `bevelWidth`, `bevelAngle`, `rearPocket`, `wallContactLand`, `minimumRemainingThickness` | Face thickness and total projection are distinct. Retain wall contact and avoid original device/yoke/screw interference. |
| Fastening | `attachmentType`, `fasteners[]`, `carrierModel`, `clipProfiles[]`, `clipClearance` | Device screws, box screws, snap-on subplate, carrier clips, bayonet or overlay attachment. Store exact XY coordinates, hole/slot dimensions, thread identifier, head diameter, countersink/counterbore depth/angle and engagement limits. Plate screws and box screws are different interfaces. |
| Labels | `labels[].controlId`, `text`, `font`, `size`, `position`, `rotation`, `alignment`, `lineSpacing`, `tracking`, `icon`, `language` | One label per controllable function; top/bottom/side/free placement; wrap or resize with preview. Do not silently clip or change wording. |
| Text geometry | `labelTreatment`, `reliefDepth`, `strokeWidth`, `edgeClearance`, `textMaterialRole` | Raised, recessed or two-color inlay/relief. Two-color is a material choice and can coexist with relief; keep those axes separate internally. |
| Decoration | `prompt`, `motifAssets`, `regions`, `textureType`, `scale`, `density`, `reliefHeight`, `recessDepth`, `materialRole`, `keepouts` | Conversational motifs, borders, textures, sculpted relief or custom imagery; preserve label areas, fastening, motion, rear interface and wall contact. Maintain edits in the saved design rather than only chat. |
| Print intent | `faceOrientation`, `plateMaterialRole`, `labelMaterialRole`, `decorationMaterialRole`, `colorMode`, `layerHeight`, `nozzleDiameter`, `fitCompensation` | Select face-up/face-down independently for all lettering styles; face down is the preferred default. Two-color needs separate material regions. Rotate the complete final geometry into print coordinates; do not mirror stored label text. Resolve actual material/tool assignment through maintained SAAM capabilities. |
| Review evidence | `geometryRevision`, `fitNotes`, `physicalFitStatus`, `machine`, `recipeRevision`, `confirmation` | Reference dimensions and dry fitting do not establish electrical compliance. SAAM owns settings, generation, review and exact-byte delivery. |

## Dimensional representation

Target convention: use the finished installation's center as XY origin; +X is right, +Y is up,
and +Z points out of the wall. Label placement uses this front view, independent
of print orientation. Each opening, fastener and keepout has explicit coordinates.
Profiles and rear depth must use the same coordinate convention. The first prototype uses lower-left origin instead; its README documents this narrower convention. A template may
derive regular layouts from a verified pitch, but stores the resolved positions.

Unestablished values are absent or null, never zero and never a guessed nominal
value. A field may carry its source, published units, tolerance and measurement
uncertainty. Preserve distinctions between product dimensions and clear openings.

## Regional and manufacturing boundaries

Country selection is a discovery aid. Common electrical switch/socket standards
(e.g. BS EN 60669, BS 1363 and regional socket standards) do not alone define
compatible decorative cover geometry. This catalog has not verified the current
standards text or electrical suitability of printed materials. Likewise a
manufacturer's UL/ETL/IP/IK or other rating belongs to its tested assembly and
must not transfer to a printed reproduction.

Before a template becomes generation-ready, establish its complete front and
rear interfaces, manufacturing clearances, motion/access keepouts and actual
retained original components. For metal exposed-work covers that mount devices
or participate in bonding, printing a decorative overlay around the retained
cover is a separate mode from replacing that cover. Do not silently substitute
plastic for structural or grounding functions. Weatherproof and other rated
assemblies remain outside validated support until their particular requirements
are addressed.
