# Canonical Implementation and Validation

Use these skill-local files as the portable legacy source of truth:

- `scripts/walled_truss_toolpath.py`: walled-truss geometry, tangent turns,
  phase construction, and calibrated controller-path validation.
- `scripts/bounded_triangular_toolpath.py`: shared point, move, calibration,
  reconstructed-arc, and controller-risk validation utilities.
- `scripts/rectangular_triangular_touchback.py`: fixed-phase rectangular
  touchback derivation.
- `scripts/triangular_wall_geometry.py`: repeat-count and bounded-core
  derivation.
- `../dobot-programmer/scripts/validate_struder_lua.py`: single-extrusion-window
  safety gate.
- `tests/test_walled_truss_toolpath.py`,
  `tests/test_bounded_triangular_toolpath.py`: geometry regression checks.
- `tests/test_triangular_wall_geometry.py`: repeat-count regression checks.

Historical programs and previews named in the robot-knowledge record remain
provenance in the old repository. They are not runtime dependencies of these
geometry modules and must not be mistaken for parameterized exporters.

Before handing off Lua:

1. Regenerate preview and Lua from the same canonical move model.
2. From this skill directory, run
   `python -m unittest discover -s tests -p "test_*.py"`.
3. Run
   `python ../dobot-programmer/scripts/validate_struder_lua.py <src1.lua>`.
4. Run `git diff --check`.
5. Confirm exactly one `PenOn()` and no intermediate `PenOff()` or DO8 cycle.
6. Confirm all phase transitions advance forward and remain on the boundary
   where the previous layer ended.
7. Confirm the final shutoff uses `END_RETRACT_LEAD_MM` and lifts immediately.
