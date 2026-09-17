# Collision-planning proposal

A requested design study, separate from the [implemented travel contract](motion.md#whole-plan-travel-requirement).

## General collision avoidance — options for review

Status: proposal for review under [BR-019](../../DEVLOG.md#br-019--h2d-wedge-and-studio-reopenactivity).
Implementation and contributor approval remain unconfirmed. Recommendation: own one small SAAM contract for machine
motion and clearance, implement its XYZ case first, and evaluate Tesseract as
the first robot-arm backend. Keep the same skills, composition, print bundle,
two confirmations and exact-export Studio review.

### Three implementation options

| Option | What SAAM would own | Advantages | Cost and limits |
|---|---|---|---|
| A. Small in-house motion layer plus a collision library | Scene, travel search, kinematics integration, process constraints and validation; a library supplies distance/contact queries. | Lightest initial XYZ integration; full control of the contract and deployment. | Robot reachability, continuous joint solutions, singularities and trajectory optimization become substantial SAAM work. A collision library alone cannot plan a robot print. |
| B. Shared SAAM contract with a Tesseract backend — recommended for evaluation | Process intent, deposited-material history, locked policies, export and review; Tesseract supplies robot scene/kinematics/planning and contact queries. | Fits surface-following manufacturing; core can run without ROS. Keeps robotics details out of slicing skills. | Native C++/Python dependency and packaging work; additive occupancy and controller verification remain ours. Validate Windows deployment and the first actual robot before choosing it. |
| C. Shared SAAM contract with a MoveIt 2 backend | Same SAAM-facing interface, with a ROS robot/planning scene integration. | Attractive when the robot cells already use ROS 2 and MoveIt. Reuses their robot configuration and surrounding tooling. | Larger runtime integration for a local printer app; deposition constraints and exact controller replay still need SAAM adapters. Choose it when the existing robot ecosystem justifies it. |

These are alternative backends, not separate printing workflows. FCL supplies
collision, distance and continuous-motion queries but does not supply our
manufacturing planner ([FCL project](https://github.com/flexible-collision-library/fcl)).
Tesseract documents process trajectories, URDF/SRDF models and a ROS-independent
core ([Tesseract](https://tesseract-robotics.github.io/tesseract/why_tesseract.html));
its contact-manager interface separates geometry/transform queries from robot
connectivity and supports discrete and swept checks
([collision API](https://tesseract-robotics.github.io/tesseract/collision.html)).
MoveIt's planning scene combines robot state, robot model and environment for
kinematics, constraints and collision checks
([MoveIt planning scene](https://moveit.picknik.ai/main/api/html/planning_scene_overview.html)).
The recommendation is an architectural assessment, not a benchmark result or
an endorsement of vendor performance comparisons.

### The shared contract

**Describe the whole moving system.** Extend machine definitions with a link/joint
model, tool center point and calibrated frames, joint limits, collision shapes,
parking/start state and a declared controller interpolation model. Include both
nozzles, carriage and moving bed on printers; include every arm link, extruder,
mount, positioner and conservative cable/hose envelope on robot cells. A printable
XYZ box is not a collision model. Store fixture/table/clamp geometry and placement
in the local job setup, separate from reusable machine geometry. Unknown geometry
must remain explicitly unchecked. Account for model, calibration, deflection and
bead uncertainty with declared clearance margins, without inventing measured values.

**Keep process intent separate from the solved machine configuration.** Skills
produce deposition curves, volumes, feature/operation IDs and tool-orientation
constraints through one common result interface. Existing XYZ skills imply a
fixed nozzle orientation. Robot support needs a versioned SAAMpath extension
for tool pose (position and orientation), frame identity, coordinated external
axes, motion/interpolation semantics and a resolved joint trajectory or bound
companion data in the same bundle. Preserve units explicitly: SAAM uses mm;
robot libraries commonly use meters and radians. Do not force every slicing
skill to solve inverse kinematics or adopt robot-library objects.

**Track material as the print progresses.** Test against existing stock, fixtures
and beads already deposited at that point in the composed sequence. The final
CAD solid alone both over-restricts future empty space and misses real bead,
prime and support geometry. Start with conservative bead volumes or chunked
voxels with a locked tolerance. Keep direct spline slicing; a bounded conservative
collision proxy does not replace native geometry. A coarse height field is an
XYZ optimization, not the contract for overhangs or arbitrary orientations.

**Check more than endpoints.** A nozzle can have clear endpoints while its body
hits a wall between them, and an elbow can collide while the nozzle clears.
Validate the swept geometry of all relevant links under the actual interpolation.
For articulated motion, simply interpolating endpoint link poses is not generally
the same as interpolating joints and applying forward kinematics. Use a supported
continuous method or conservative subdivision with explicit error bounds; report
unsupported cases instead of calling sparse sampling a proof. Also reject
unreachable poses, joint-limit violations, branch jumps and configured singularity
or motion-limit violations. These are related feasibility checks, distinct from
collision detection.

**Allow only the intended printing contact.** The depositing tip/bead region needs
a narrow, operation-specific contact allowance. Do not disable collision checking
between the entire head and the entire printed object. Nearby shrouds, an inactive
nozzle and robot links still need clearance.

### Where it belongs in the current pipeline

The composer owns chronology and calls one machine-motion interface for joins,
travels, cooling and parking. Collision queries answer whether a candidate
motion clears the scene; a planner searches alternative motions using those
queries. Start by checking/reporting; automatic travel repair comes afterward.
Deposition is checked too, not just non-extruding travel. The wedge already uses the shared XYZ travel builder with its documented
bounded direct-move policy; general collision queries remain proposed.

The approved process plan locks clearance margins, allowed contact, orientation
freedom, motion limits, planner/version, search budget and any seed, and permitted
travel/reordering rules. Generation solves those choices directly. If a valid
solution requires changing deposition geometry, exceeding allowed tilt or changing
operation dependencies, return to settings review. Do not silently distort a
printing stroke or add a fourth approval stage. Persist the resolved trajectory;
reopening must not pick a different robot configuration through a fresh random
search. Reuse exact stored trajectories with integrity and validity checks.

After timing, smoothing and export, reconstruct and validate the commanded
trajectory again. Controller blending and Cartesian versus joint interpolation
can change the swept motion. MoveIt's documentation explicitly notes that its
time-optimal parameterization can change a path within tolerance and may require
another collision check
([trajectory processing](https://moveit.picknik.ai/main/doc/examples/time_parameterization/time_parameterization_tutorial.html)).
Joint timing must remain synchronized with deposition volume and process speed.
Unknown firmware/service routines stay outside a claimed complete collision pass;
this is already relevant to the H2D startup envelope.

Studio should play the interpreted export with the machine geometry and deposited
material, highlight the first conflicting bodies and operation, show the required
versus achieved clearance, and state any unchecked portions. Bind the report to
geometry, scene, calibration, machine model, solver settings and exact export
hashes. Changes invalidate the affected settings/toolpath approvals. This remains
software validation; cell interlocks and personnel protection are separate systems.

### Suggested evaluation sequence

1. Agree on the shared data and query boundary. Model measured S5/H2D head geometry,
   both nozzles and fixtures; validate existing paths without altering deposition.
2. Add deterministic XYZ travel repair, then prove it across mixed skill operations,
   clamps, nearby walls, rising deposited material, cooling and parking. Missing
   geometry must fail coverage reporting rather than produce an all-clear result.
3. Use one real arm/end-effector/positioner model to compare the Tesseract and,
   if relevant, MoveIt adapter. Test two joint solutions for one nozzle pose,
   mid-motion link collisions, singularities, an unreachable stroke, a tilted
   nozzle near a wall, units/transforms and export blending. Measure runtime and
   packaging cost on our supported platforms before selecting a backend.
4. Add independent controller/offline-simulator comparison for that machine,
   then physical validation under its normal cell commissioning procedure.

The review choices are the backend direction (A/B/C), the first robot/controller
and external axes, and how much orientation freedom a deposition skill may offer.
A lean first implementation can establish the common contract without making a
robotics framework mandatory for S5/H2D users.
