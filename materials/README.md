# Generic filament profiles

SAAM selects a generic material family, not a manufacturer/color SKU. The
profiles in [generic.json](generic.json) own filament diameters, nozzle and bed
temperature ranges/defaults, conservative maximum volumetric flow, retraction,
density and exporter identifiers. Temperatures and process values are proposed
defaults; Studio exposes overrides and validates the final combination.

The catalog was distilled on 2026-09-12 from the MIT-licensed
[Open Filament Database](https://github.com/OpenFilamentCollective/open-filament-database).
Its material folders were counted by declared family: PLA 146, PETG 108, ABS
73, TPU 72, ASA 64, PC 29, PA6 29, PA12 26, PP 20, PVA 16, with a long tail of
specialty polymers. Only 32 product records declared a minimum nozzle diameter,
so that database is evidence for useful family groupings and temperature fields,
not sufficient evidence for machine/core compatibility. SAAM therefore groups
the common thermoplastic families, combines PA6/PA12 as Nylon, combines TPU/TPE,
and keeps soluble support and abrasive composite categories where tooling really
changes. Brand, color and marketing variants are deliberately excluded.

UltiMaker GUIDs and generic defaults come from its official
[fdm_materials repository](https://github.com/Ultimaker/fdm_materials). H2D
material IDs are generic family metadata for the generated package. A profile
does not assert that every formulation prints identically: filled, flexible,
support and high-temperature families remain separate when their process or
hardware constraints materially differ.
