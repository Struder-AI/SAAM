# Canonical Implementation and Validation

Use these repository files as the executable source of truth:

- `tools/walled_truss_toolpath.py`: walled-truss geometry, tangent turns,
  phase construction, and calibrated controller-path validation.
- `tools/export_walled_truss_lua.py`: successful-reference ring exporter.
- `tools/export_walled_truss_cup_lua.py`: closed-bottom 80 mm cup exporter.
- `tools/generate_walled_truss_preview.py`: reference-ring preview.
- `tools/generate_walled_truss_cup_preview.py`: four-view cup preview.
- `tools/bounded_triangular_toolpath.py`: shared point, move, calibration,
  reconstructed-arc, and controller-risk validation utilities.
- `tools/validate_struder_lua.py`: single-extrusion-window safety gate.
- `tests/test_walled_truss_toolpath.py` and
  `tests/test_bounded_triangular_toolpath.py`: geometry regression checks.

Preserved programs and previews:

- `firmware/dobotstudio/working_walled_truss_ring_60d_8w/src1.lua`
- `firmware/dobotstudio/working_walled_truss_cup_80od_12w_80h/src1.lua`
- `firmware/dobotstudio/working_bounded_triangular_wall_controller_exact/`
  (failed historical branch; do not treat as approved)
- `generated_previews/walled_truss_ring_60d_8w_proposed.svg`
- `generated_previews/walled_truss_cup_80od_12w_80h_proposed.svg`

Before handing off Lua:

1. Regenerate preview and Lua from the same canonical move model.
2. Run `python -m unittest discover -s tests`.
3. Run `python -m tools.validate_struder_lua <src1.lua>`.
4. Run `git diff --check`.
5. Confirm exactly one `PenOn()` and no intermediate `PenOff()` or DO8 cycle.
6. Confirm all phase transitions advance forward and remain on the boundary
   where the previous layer ended.
7. Confirm the final shutoff uses `END_RETRACT_LEAD_MM` and lifts immediately.
