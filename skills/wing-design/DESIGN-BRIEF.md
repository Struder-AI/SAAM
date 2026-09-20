# Wing design brief

Status: workspace stub with user-requested product requirements below. The viewer,
candidate browser and wing generation are not yet implemented. Airfoil source
research is recorded in [AIRFOIL-SOURCES.md](AIRFOIL-SOURCES.md).

## Intended result

Help a person design a 3D printed wing, tail surfaces and associated control
surfaces through conversation and review the result in SAAM Studio. Fuselage
attachment geometry is in scope; this does not imply a complete fuselage designer.

The workspace focuses on **Use / Shape / Construction**. Printing settings and
machine output remain in SAAM's existing downstream review and delivery workflow.

## Design choices to develop together

| Topic | Open choices |
|---|---|
| Use | Application, aircraft configuration, size/mass, speed range and priorities such as slow flight, endurance, speed or aerobatics. Establish enough context to compare airfoils at relevant operating conditions. |
| Shape | Search and compare airfoils, then define span, root/tip chord, taper, sweep, dihedral, twist, tails and control-surface geometry. |
| Construction | Skin and hollow interior, ribs, reinforcement strategy, fuselage attachment, joints and inserted hardware models such as servos, hinges and control horns. |

Individual wing dimensions, airfoils and construction choices remain open. Keep
candidate defaults explicit and carry them into a preview for revision.

## Guided conversation and progressive CAD

The requested sequence is **Use → airfoil and wing shape → control surfaces and
tails → reinforcement and fuselage attachment**. These are revisitable stages
within Use / Shape / Construction, not one-way approval gates. Carry the craft's
purpose and flight priorities through every recommendation. Ask about the next
meaningful choice, explain relevant alternatives, and show the resulting feature
as soon as the choice is sufficiently defined.

| Stage | Conversation | Required model update |
|---|---|---|
| Use and airfoil | Understand the craft and priorities, compare relevant sections and select an airfoil. Establish or propose enough planform dimensions to preview it. | Display the wing using the selected section and current dimensions; distinguish provisional dimensions from chosen ones. |
| Control surfaces and tails | Immediately after airfoil selection, establish required control functions and the desired surfaces. Include ailerons, flaps, elevators and rudders as applicable; discuss combined functions such as elevons or flaperons when the craft calls for them. Establish whether there is a conventional tail, another tail arrangement or no tail. | Add the selected surfaces to the wing/tail assembly with visible boundaries and separate identities. Do not automatically reuse the wing airfoil for the tail. |
| Control-surface detail | Discuss each surface's role, spanwise extent, chord, flap type, hinge arrangement and intended motion, then servo, hinge, horn and linkage placement. Help choose the geometry from the function and available space rather than presenting unexplained dimensions. | Update actual surface geometry, hinge gaps/axes, mounting provisions and inserted hardware. A motion preview should show the selected deflection and expose geometric interference without claiming control authority has been validated. |
| Reinforcement and attachment | Select a coherent structural and mounting strategy together: number, location and form of reinforcements; where loads enter the fuselage; removable versus permanent connections. | Add actual reinforcement members, matching cavities/channels, joints and fuselage attachment features. Keep external hardware identifiable and independently visible. |

A later change must update dependent features or identify the specific conflict.
For example, moving a spar can affect a servo bay, and changing a flap's chord
can affect its hinge and horn. Do not leave a visually plausible but stale
assembly. Keep unrelated choices and camera position when rebuilding; show when
an update is pending or failed. Preserve the last valid model on failure and
explain which proposed feature could not be applied.

## Control-surface choices

Discuss whether the craft needs ailerons, flaps or combined surfaces, and what
the flaps are intended to accomplish. The conversation should distinguish a
simple hinged flap from a slotted or translating arrangement when relevant;
only offer an arrangement as buildable once its geometry and motion are supported.
Surface count, segmentation, symmetry and separate left/right controls should
be explicit rather than implicit in a single wing mesh.

Tail design includes the fixed stabilizing surfaces and their movable controls,
with placement relative to the craft. Tail sizing, control effectiveness and
stability depend on aircraft context; an attractive CAD assembly is not evidence
of those results. Retain unknown fuselage, balance and load inputs as unknown.

## Printed section construction

The intended construction is continuous-vase wing sections with integral skin
stiffeners and tube-channel webs, assembled onto separate reinforcing tubes and
glued/plastic welded together. Conventional transverse ribs currently shown in
the prototype are not the user's intended construction. See
[Vase construction research](VASE-CONSTRUCTION.md) for the CAD topology, supplied
example inspection, toolpath proof boundary and section-preview requirements.
Section breaks should accommodate control-surface boundaries and printer usable
Z, as well as the footprint and joint allowances in the chosen print orientation.

## Reinforcement and fuselage attachment choices

The guided discussion must include the user-requested alternatives:

- A wing mounted on top of the fuselage, with bolts or rubber-band retention.
  Develop the seating/contact geometry and the corresponding mounting features
  with the selected strategy.
- Telescoping tube-in-tube connections. The requested initial arrangement uses
  straight, zero-sweep tube axes with coaxial mating sections. Preserve an
  insertion/removal path and define overlap, clearance and retention. This
  constraint applies to the connector axes; it does not inherently require
  the wing's leading edge or overall planform to have zero sweep. Check that
  the straight tubes fit within the chosen wing and fuselage interface.
- One or more large internal tubes versus reinforcements embedded near the
  wing's outer surface. Establish count, paths, cross-sections and the relation
  to skin, ribs, control surfaces and hardware.
- Reinforcement installation by gluing or welding in with Struder. Record which
  method is intended and model the needed channel and access. Welding process
  compatibility and strength require their own supported workflow and evidence;
  a modeled feature alone does not establish either.

These are supported conversation requirements, not yet implemented construction
options or default structural recommendations. Propose dimensions with their
basis; do not invent load capacity from tube diameter or member count alone.

## Requested viewer

Show the designed wing in 3D with orbit, pan, zoom and inspection behavior like
the normal SAAM viewer. Preserve the camera while changing visibility.

- Wireframe mode reveals internal hollow structures. Merely drawing triangle
  edges over an opaque outer skin does not satisfy this requirement; the skin
  must stop obscuring the interior in this mode.
- Spar visibility can be turned on and off independently.
- Inserted hardware visibility can be turned on and off, including servos,
  hinges and control horns. Proposed control layout: a Hardware group with
  individual component switches below it.

Visibility is a viewing choice, not removal from the design or a change to what
will be manufactured. Hardware models must remain identifiable as reference
components rather than automatically becoming printable wing material.
The viewer must show actual designed hollow regions, reinforcements, tails and
control surfaces as they are added, rather than icons standing in for CAD changes.

## Requested airfoil selection experience

Begin with a knowledgeable conversation about Use. Present a scrollable shortlist
of candidate airfoils with profile thumbnails, relevant specifications and a
plain-language explanation of each candidate's fit and tradeoffs. Allow search
and comparison, and retain the user's selection in the wing design.

The proposed source strategy and candidate-card fields are in
[AIRFOIL-SOURCES.md](AIRFOIL-SOURCES.md). Missing performance data should remain
visible as missing. Measured results and numerical predictions must be labeled
separately and compared at relevant, compatible conditions.

## First implementation slice

Source research is the first requested step. Proposed next implementation slice:
an application-aware, searchable airfoil shortlist with inspectable source
coordinates, followed by the selected section in the wing viewer. The detailed
UI and geometry integration remain to be developed together; no existing stub
screen is being presented as an operational design workspace.
