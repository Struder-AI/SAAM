# Clean Online-mode global baseline

**ROBOT-CONFIRMED ONLINE-MODE BASELINE — 2026-08-14**

This directory starts the new Online-mode workflow without the old demo-era
`THIN_*`, `THICK_*`, `PrintZ()`, or generic `PRINT_HEIGHT_ABOVE_BED` variables.

The explicit deposition state is:

- `BED_ZERO_Z = -90.44`
- `LAYER_HEIGHT_MM = 0.70`
- `PRINT_Z = -89.74`
- `PRINT_SPEED_MM_S = 3.0`
- `MEASURED_LINE_WIDTH_MM = 0.83`
- `SOLID_LINE_SPACING_MM = 0.78`

The legacy Remote I/O globals remain preserved in their historical milestone
directories and must not be copied into this Online project.

Robot-confirmed sequence:

- Direct Online execution, Tool 1/User 1, and live-pose-relative motion were
  recovered through staged tests.
- The calibrated 20 x 20 mm single-line square printed successfully. Its
  outside dimension was approximately 21 mm, consistent with the 0.83 mm bead
  within the available measurement precision.
- The calibrated 100 x 100 mm square spiral-vase wall printed successfully to
  10 mm height. Its visibly straight walls confirm the nonlinear XY correction
  on a continuous 3D path. No Z bed-warp map was used.
- Starting posture matters. The unchanged vase program alarmed after the robot
  was manually displaced substantially higher, then ran after it was returned
  near the bed-centered printing posture. Before Start, park the nozzle roughly
  above User-frame X0/Y0 in the familiar printing posture. Arbitrary-posture
  recovery is outside this baseline's requirements.
