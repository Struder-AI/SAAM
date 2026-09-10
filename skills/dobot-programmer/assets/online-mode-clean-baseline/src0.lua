--=========================================================
-- ONLINE MODE: PRINT 20 x 20 MM SINGLE-LINE SQUARE
-- Revision marker: ONLINE_PRINT_SQUARE_20MM_R1_2026_08_14
-- Requires online_mode_clean_baseline/global.lua
--=========================================================

local livePose = GetPose()
local r0 = livePose.coordinate[4]

local HALF_SIZE_MM = 10.0
local LEAD_IN_MM = 8.0
local APPROACH_CLEARANCE_MM = 10.0
local END_LIFT_MM = 25.0
local SHUTOFF_LEAD_MM = 6.0

local CAL_X_SCALE = 0.9913187641
local CAL_Y_SCALE_AT_X0 = 0.82792485
local CAL_Y_SCALE_PER_COMMAND_X = 0.000476289593
local CAL_BOW_Y_RADIUS = 90.0

local function BowAtX(x)
    if x <= -70.0 then
        return 3.330000
    elseif x < -52.5 then
        return 3.330000 + ((x + 70.0) / 17.5) * (3.033125 - 3.330000)
    elseif x < -35.0 then
        return 3.033125 + ((x + 52.5) / 17.5) * (2.396250 - 3.033125)
    elseif x < -17.5 then
        return 2.396250 + ((x + 35.0) / 17.5) * (2.159375 - 2.396250)
    elseif x < 0.0 then
        return 2.159375 + ((x + 17.5) / 17.5) * (1.882500 - 2.159375)
    elseif x < 17.5 then
        return 1.882500 + (x / 17.5) * (1.815625 - 1.882500)
    elseif x < 35.0 then
        return 1.815625 + ((x - 17.5) / 17.5) * (1.408750 - 1.815625)
    elseif x < 52.5 then
        return 1.408750 + ((x - 35.0) / 17.5) * (1.471875 - 1.408750)
    elseif x < 70.0 then
        return 1.471875 + ((x - 52.5) / 17.5) * (1.255000 - 1.471875)
    end

    return 1.255000
end

local function BowEnvelope(y)
    if y <= -CAL_BOW_Y_RADIUS or y >= CAL_BOW_Y_RADIUS then
        return 0.0
    end

    local normalizedY = y / CAL_BOW_Y_RADIUS
    return 1.0 - (normalizedY * normalizedY)
end

local function CalibratedXY(x, y)
    local baseCorrectedX = x * CAL_X_SCALE

    local correctedX = baseCorrectedX
        - (BowAtX(x) * CAL_X_SCALE * BowEnvelope(y))

    local yScale = CAL_Y_SCALE_AT_X0
        + (CAL_Y_SCALE_PER_COMMAND_X * baseCorrectedX)

    return correctedX, y * yScale
end

local function Point(x, y, z)
    local correctedX, correctedY = CalibratedXY(x, y)

    return {
        coordinate = {correctedX, correctedY, z, r0},
        tool = ACTIVE_TOOL,
        user = ACTIVE_USER,
        armOrientation = livePose.armOrientation
    }
end

local travelMotion = {
    SpeedL = TRAVEL_SPEED_MM_S,
    AccL = TRAVEL_ACCEL_MM_S2
}

local printMotion = {
    CP = 1,
    SpeedL = PRINT_SPEED_MM_S,
    AccL = PRINT_ACCEL_MM_S2
}

local xMin = -HALF_SIZE_MM
local xMax = HALF_SIZE_MM
local yMin = -HALF_SIZE_MM
local yMax = HALF_SIZE_MM

local leadX = xMin - LEAD_IN_MM
local leadY = yMin

local approachZ = PRINT_Z + APPROACH_CLEARANCE_MM
local safeZ = livePose.coordinate[3]

if safeZ < approachZ then
    safeZ = approachZ
end

-- Start with extrusion definitely off.
PenOff()

-- Reposition above the external lead-in without crossing printed material.
MovL(Point(leadX, leadY, safeZ), travelMotion)
MovL(Point(leadX, leadY, approachZ), travelMotion)
MovL(Point(leadX, leadY, PRINT_Z), travelMotion)

-- One continuous extrusion window.
PenOn()

-- External lead-in, then one 20 x 20 mm perimeter.
MovL(Point(xMin, yMin, PRINT_Z), printMotion)
MovL(Point(xMax, yMin, PRINT_Z), printMotion)
MovL(Point(xMax, yMax, PRINT_Z), printMotion)
MovL(Point(xMin, yMax, PRINT_Z), printMotion)

-- Final side: stop feed 6 mm before reaching the starting corner.
MovL(Point(xMin, yMin + SHUTOFF_LEAD_MM, PRINT_Z), printMotion)
DO(EXTRUDER_DO, 0)
MovL(Point(xMin, yMin, PRINT_Z), printMotion)

-- Lift immediately at the endpoint.
MovL(Point(xMin, yMin, PRINT_Z + END_LIFT_MM), travelMotion)

print("ONLINE_PRINT_SQUARE_20MM_COMPLETE")
