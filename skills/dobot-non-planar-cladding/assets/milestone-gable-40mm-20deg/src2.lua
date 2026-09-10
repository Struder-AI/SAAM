--=========================================================
-- ROBOT-CONFIRMED: 40 x 40 mm non-planar GABLE coupon
-- SRC2 entry point: white DI2 button calls RunSrc2()
-- Ridge is parallel to X at Y=0. Y/Z finish strokes climb
-- one face and descend the other. No perimeter loops.
-- One uninterrupted extrusion window; all in-part transitions
-- are deposited. Initial approach matches the prior working coupon.
--=========================================================

function RunSrc2()
    local r0 = READY_R
    local z0 = ThickPrintZ()
    local cp = 1.0
    local h = 20.0
    local rise = 0.70
    local solidSpacing = 0.78
    local meshSpacing = 3.12
    local slope = 0.3639702343       -- tan(20 degrees)
    local slopeSpeed = 2.8190778624  -- 3.0 * cos(20 degrees)
    local ridgeZ = rise + h*slope

    local px, py, pz = -20.0, -20.0, 0.0
    local rx, ry, rz = px, py, pz
    local queued = nil

    local function Q(x, y, z)
        return P(x, y, z, r0)
    end

    local function Execute(m)
        MovL(Q(m.x, m.y, z0 + m.z),
             {CP=cp, SpeedL=m.s, AccL=PRINT_ACCEL})
        rx, ry, rz = m.x, m.y, m.z
        LAST_MOVE_WAS_JUMP = false
    end

    -- Buffer the final target so END_RETRACT_LEAD_MM is applied only to
    -- the true final roof stroke, with no pause before the lift.
    local function Queue(x, y, z, speed)
        if queued ~= nil then Execute(queued) end
        queued = {x=x, y=y, z=z, s=speed}
        px, py, pz = x, y, z
    end

    local function ZFlat(z)
        return function(x, y) return z end
    end

    local function ZRoof(offset)
        return function(x, y)
            return rise + (h-math.abs(y))*slope + offset
        end
    end

    local function Dist2(x, y, z)
        local dx, dy, dz = x-px, y-py, z-pz
        return dx*dx + dy*dy + dz*dz
    end

    -- Continuous serpentine raster. The closest equivalent orientation is
    -- selected. Its first commanded stroke begins at the inherited endpoint,
    -- absorbing the layer rise instead of pausing for a separate Z move.
    local function Raster(x0, x1, y0, y1, spacing, alongX, zAt, speed)
        local low = alongX and y0 or x0
        local high = alongX and y1 or x1
        local intervals = math.ceil((high-low)/spacing)
        if intervals < 1 then intervals = 1 end
        local step = (high-low)/intervals
        local bestReverseRows = false
        local bestReverseFirst = false
        local bestDistance = nil

        for rr=0,1 do
            for rf=0,1 do
                local value = (rr == 1) and high or low
                local ax, ay
                if alongX then ax, ay = x0, value
                else ax, ay = value, y0 end
                if rf == 1 then
                    if alongX then ax = x1 else ay = y1 end
                end
                local d = Dist2(ax, ay,zAt(ax, ay))
                if bestDistance == nil or d < bestDistance then
                    bestDistance = d
                    bestReverseRows = (rr == 1)
                    bestReverseFirst = (rf == 1)
                end
            end
        end

        for i=0,intervals do
            local rowIndex = bestReverseRows and (intervals-i) or i
            local value = low + rowIndex*step
            local reverse = ((i % 2) == 1)
            if bestReverseFirst then reverse = not reverse end
            local ax, ay, bx, by
            if alongX then
                ax, ay, bx, by = x0, value, x1, value
            else
                ax, ay, bx, by = value, y0, value, y1
            end
            if reverse then ax, bx, ay, by = bx, ax, by, ay end
            if i > 0 then Queue(ax, ay, zAt(ax, ay), speed) end
            Queue(bx, by, zAt(bx, by), speed)
        end
    end

    -- Y/Z gable raster. Full rows climb from one eave to the ridge and
    -- descend the other face. The last row is a half-row ending at the ridge,
    -- leaving the nozzle at the highest Z before shutdown and lift.
    local function GableRaster(spacing, offset, speed)
        local intervals = math.ceil((2.0*h)/spacing)
        if intervals < 1 then intervals = 1 end
        local step = (2.0*h)/intervals
        local reverseX = math.abs(px-h) < math.abs(px+h)
        local side = (py <= 0.0) and -h or h

        local firstX = reverseX and h or -h
        Queue(firstX, side, ZRoof(offset)(firstX, side), speed)

        for i=0,intervals do
            local x = reverseX and (h-i*step) or (-h+i*step)
            Queue(x, 0.0, ZRoof(offset)(x, 0.0), speed)
            if i == intervals then break end
            local other = -side
            Queue(x, other, ZRoof(offset)(x, other), speed)
            side = other
            local nextX = reverseX and (h-(i+1)*step) or (-h+(i+1)*step)
            Queue(nextX, side, ZRoof(offset)(nextX, side), speed)
        end
    end

    PenOff()

    -- Exact initial approach from the prior successful coupon. At startup the
    -- bed is empty, so finished-part barrel clearance does not apply yet.
    MovJ(Q(-26.0, -20.0, z0 + 8.0),
         {SpeedJ=JUMP_SPEED, AccJ=JUMP_ACCEL})
    MovL(Q(-26.0, -20.0, z0),
         {SpeedL=JUMP_SPEED, AccL=JUMP_ACCEL})
    LAST_MOVE_WAS_JUMP = true
    PenOn()

    -- Deposited external lead-in meets the model only at its first corner.
    MovL(Q(px, py, z0 + pz),
         {CP=cp, SpeedL=PRINT_SPEED, AccL=PRINT_ACCEL})
    LAST_MOVE_WAS_JUMP = false

    -- L1 dense base, no perimeter. L2 is the full 25% Y scaffold.
    Raster(-h, h, -h, h, solidSpacing, true, ZFlat(0.0), 3.0)

    -- The symmetric gable begins on L3 and contracts equally from both eaves.
    local topIndex = math.floor(ridgeZ/rise + 0.000000001)
    for layer=2,topIndex+1 do
        local z = (layer-1)*rise
        local yLimit = h
        if layer >= 3 then yLimit = h-(z-rise)/slope end
        if yLimit < 0.0 then yLimit = 0.0 end
        local alongX = ((layer % 2) == 1)
        Raster(-h, h, -yLimit, yLimit, meshSpacing,
               alongX, ZFlat(z), 3.0)
    end

    -- Proven three-skin schedule, now folded symmetrically about Y=0.
    GableRaster(solidSpacing/0.50, 0.0, slopeSpeed) -- 50% Y/Z
    Raster(-h, h, -h, h, solidSpacing, true,
           ZRoof(rise), 3.0)                       -- solid X
    GableRaster(solidSpacing, 2.0*rise, slopeSpeed) -- solid Y/Z finish

    -- Early shutoff on the final eave-to-ridge stroke. The nozzle reaches the
    -- ridge with flow off, then immediately lifts in place above all geometry.
    local dx, dy, dz = queued.x-rx, queued.y-ry, queued.z-rz
    local length = math.sqrt(dx*dx + dy*dy + dz*dz)
    local retract = END_RETRACT_LEAD_MM or 6.0
    if retract < 0.0 then retract = 0.0 end
    if retract > length then retract = length end
    local f = 1.0-retract/length
    local offX = rx+dx*f
    local offY = ry+dy*f
    local offZ = rz+dz*f

    MovL(Q(offX, offY, z0+offZ),
         {CP=cp, SpeedL=queued.s, AccL=PRINT_ACCEL})
    DO(PEN_DO, 0)
    PEN_IS_ON = false
    MovL(Q(queued.x, queued.y, z0+queued.z),
         {CP=cp, SpeedL=queued.s, AccL=PRINT_ACCEL})
    MovL(Q(queued.x, queued.y, z0+queued.z+END_LIFT_MM),
         {SpeedL=JUMP_SPEED, AccL=JUMP_ACCEL})
    MovL(Q(0.0, 0.0, z0+queued.z+END_LIFT_MM),
         {SpeedL=JUMP_SPEED, AccL=JUMP_ACCEL})
end
