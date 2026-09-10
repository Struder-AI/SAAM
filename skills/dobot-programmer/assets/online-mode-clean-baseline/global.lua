--=========================================================
-- ONLINE MODE GLOBAL CONFIGURATION
-- Revision marker: ONLINE_GLOBAL_CLEAN_R5_2026_08_15
--
-- This is a clean replacement for the old demo-era thin/thick globals.
--=========================================================

ACTIVE_TOOL = 1
ACTIVE_USER = 1

-- Absolute Z coordinate of the physical bed surface in User Frame 1.
BED_ZERO_Z = -90.44

-- Robot-confirmed deposition settings for the calibrated Struder condition.
LAYER_HEIGHT_MM = 0.70
PRINT_SPEED_MM_S = 3.0
MEASURED_LINE_WIDTH_MM = 0.83

-- Nominal centerline spacing for fully filled adjacent lines.
SOLID_LINE_SPACING_MM = 0.78

-- Default sacrificial purge-path requirements. Geometry remains local to each
-- program because it must be planned from that part's complete XY envelope.
PRIME_ENABLED = true
PRIME_MIN_PATH_MM = 100.0
PRIME_CLEARANCE_MM = 5.0
PRIME_LANE_PITCH_MM = 4.0
PRIME_TURN_RADIUS_MM = 2.0
PRIME_BED_EDGE_MARGIN_MM = 3.0

-- Optional first-layer corner-adhesion defaults. The program must derive and
-- clip each ear from the complete finished part footprint.
DOG_EAR_DEFAULT_DIAMETER_MM = 25.0
DOG_EAR_PRINT_SPEED_MM_S = 4.5
DOG_EAR_ESTIMATED_LINE_WIDTH_MM = 0.553
DOG_EAR_LINE_SPACING_MM = 1.80
DOG_EAR_BREAKAWAY_GAP_MM = 1.00
DOG_EAR_CONTACT_COUNT = 3

-- The current program's first-layer centerline Z.
-- Programs may deliberately override their local layer height when the
-- requested process requires a different validated deposition condition.
PRINT_Z = BED_ZERO_Z + LAYER_HEIGHT_MM

PRINT_ACCEL_MM_S2 = 20
TRAVEL_SPEED_MM_S = 100
TRAVEL_ACCEL_MM_S2 = 100

EXTRUDER_DO = 8
EXTRUSION_START_WAIT_MS = 4500
EXTRUSION_IS_ON = false

function PenOn()
    if not EXTRUSION_IS_ON then
        DO(EXTRUDER_DO, 1)
        EXTRUSION_IS_ON = true

        if EXTRUSION_START_WAIT_MS > 0 then
            Wait(EXTRUSION_START_WAIT_MS)
        end
    end
end

function PenOff()
    DO(EXTRUDER_DO, 0)
    EXTRUSION_IS_ON = false
end
