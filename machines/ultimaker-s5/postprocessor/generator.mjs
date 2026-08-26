// Reference post-processor: translates an approved process plan
// (schemas/process-plan/process-plan.schema.json) into Griffin-flavor
// G-code for the ultimaker-s5 machine. No dependencies.
//
// Translates or rejects. Never redesigns geometry — see
// ../../../docs/architecture/operations-vs-postprocessors.md.
//
// Unlike the Dobot reference post-processor, the structural conventions
// here (header block, absolute extrusion, per-gap retract/prime,
// no in-body bed-heat command) are not general FDM knowledge assembled
// from documentation — they were read directly out of a real .ufp file
// exported by Cura 5.4.0 for a real Ultimaker S5 (a sensor-bracket part,
// spiralize mode, 0.8mm nozzle). See postprocessor/README.md for exactly
// what that sample did and didn't confirm — most notably, no program
// emitted by this exact generator revision has itself been run on
// physical hardware yet, so this is DOC/sample-CONFIRMED, not
// ROBOT-CONFIRMED the way the Dobot post-processor's conventions are.

const EPSILON_MM = 0.01;
const RETRACT_MM = 5;
const DEFAULT_FILAMENT_DIAMETER_MM = 2.85; // Ultimaker's standard, NOT the 1.75mm common elsewhere.
const DEFAULT_NOZZLE_DIAMETER_MM = 0.4;
const DEFAULT_PRINT_TEMP_C = 210; // Observed in the reference sample; a PLA-range placeholder, not this project's material calibration.
const DEFAULT_BUILD_PLATE_TEMP_C = 60; // Same caveat — supply your own material's real values via instanceProfile.
const TRAVEL_FEED = 9000; // mm/min, pure XY travel — matches the reference sample.
const Z_FEED = 600; // mm/min, any move that changes Z — matches the reference sample's slower Z-axis feed.
const PRINT_FEED = 1800; // mm/min — matches the reference sample's wall/skirt print speed.
const RETRACT_FEED = 1500; // mm/min
const PRIME_FEED = 900; // mm/min
const SAFE_LIFT_MARGIN_MM = 5; // clearance above the tallest print point for the initial approach lift.
const MIN_SAFE_LIFT_MM = 20; // matches the reference sample's observed initial lift.

function distance3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function gnum(value, digits = 4) {
  return Number.isFinite(value) ? String(Number(value.toFixed(digits))) : "0";
}

// Refuses to translate anything that isn't explicitly, currently approved
// for export — the same gate the Dobot post-processor enforces in code.
function assertExportable(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("Refusing to translate: no process plan was given.");
  }
  if (plan.machine?.id !== "ultimaker-s5") {
    throw new Error(
      `Refusing to translate: this post-processor only accepts plans resolved against "ultimaker-s5" (got "${plan.machine?.id}").`
    );
  }
  if (!plan.approval) {
    throw new Error("Refusing to translate: process plan has no approval record.");
  }
  if (plan.approval.revision !== plan.revision) {
    throw new Error(
      `Refusing to translate: approval is for revision ${plan.approval.revision}, but the plan is at revision ${plan.revision}. Any change invalidates its approval.`
    );
  }
  if (plan.approval.scope !== "executable-export" && plan.approval.scope !== "machine-control") {
    throw new Error(
      `Refusing to translate: approval scope "${plan.approval.scope}" does not authorize executable export.`
    );
  }
}

function collectPrintSegments(plan) {
  const segments = [];
  for (const operation of plan.operations) {
    for (const pathEntry of operation.paths) {
      if (pathEntry.intent !== "print") continue; // matches the Dobot post-processor's existing scope: travel-intent paths aren't translated yet.
      if (!pathEntry.points.length) continue;
      segments.push({ family: pathEntry.family, layer: pathEntry.layer, points: pathEntry.points });
    }
  }
  return segments;
}

function boundingBox(segments) {
  const box = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (const segment of segments) {
    for (const p of segment.points) {
      box.minX = Math.min(box.minX, p.x);
      box.maxX = Math.max(box.maxX, p.x);
      box.minY = Math.min(box.minY, p.y);
      box.maxY = Math.max(box.maxY, p.y);
      box.minZ = Math.min(box.minZ, p.z);
      box.maxZ = Math.max(box.maxZ, p.z);
    }
  }
  return box;
}

function extrusionPerMm(settings, filamentDiameterMm) {
  const filamentArea = Math.PI * (filamentDiameterMm / 2) ** 2;
  return (settings.beadWidth * settings.layerHeight) / filamentArea;
}

function renderHeader({ box, materialVolumeMm3, printTimeEstimateS, nozzleDiameterMm, printTempC, buildPlateTempC, generatorVersion }) {
  const lines = [
    ";START_OF_HEADER",
    ";HEADER_VERSION:0.1",
    ";FLAVOR:Griffin",
    `;GENERATOR.NAME:SAAM ultimaker-s5-gcode-postprocessor`,
    `;GENERATOR.VERSION:${generatorVersion}`,
    ";TARGET_MACHINE.NAME:Ultimaker S5",
    `;EXTRUDER_TRAIN.0.INITIAL_TEMPERATURE:${gnum(printTempC, 1)}`,
    `;EXTRUDER_TRAIN.0.MATERIAL.VOLUME_USED:${gnum(materialVolumeMm3, 2)}`,
    `;EXTRUDER_TRAIN.0.NOZZLE.DIAMETER:${gnum(nozzleDiameterMm, 2)}`,
    `;BUILD_PLATE.INITIAL_TEMPERATURE:${gnum(buildPlateTempC, 1)}`,
    `;PRINT.TIME:${Math.round(printTimeEstimateS)}`, // A naive kinematic estimate (distance / feedrate), not a calibrated slicer time model — see README.
    ";PRINT.GROUPS:1",
    `;PRINT.SIZE.MIN.X:${gnum(box.minX)}`,
    `;PRINT.SIZE.MIN.Y:${gnum(box.minY)}`,
    `;PRINT.SIZE.MIN.Z:${gnum(box.minZ)}`,
    `;PRINT.SIZE.MAX.X:${gnum(box.maxX)}`,
    `;PRINT.SIZE.MAX.Y:${gnum(box.maxY)}`,
    `;PRINT.SIZE.MAX.Z:${gnum(box.maxZ)}`,
    ";END_OF_HEADER",
    `;Generated by SAAM ultimaker-s5-gcode-postprocessor ${generatorVersion}`,
  ];
  return lines.join("\n") + "\n";
}

/**
 * @param {object} args
 * @param {object} args.plan - an approved process plan (schemas/process-plan/)
 * @param {object} [args.instanceProfile] - this unit's material/nozzle configuration; see instance-profile.example.json
 * @returns {{ files: Record<string,string>, warnings: Array }}
 */
export function translate({ plan, instanceProfile } = {}) {
  assertExportable(plan);

  const segments = collectPrintSegments(plan);
  if (!segments.length) {
    throw new Error("Refusing to translate: the plan has no print-intent points to emit.");
  }

  const filamentDiameterMm = instanceProfile?.filamentDiameterMm ?? DEFAULT_FILAMENT_DIAMETER_MM;
  const nozzleDiameterMm = instanceProfile?.printCore?.nozzleDiameterMm ?? DEFAULT_NOZZLE_DIAMETER_MM;
  const printTempC = instanceProfile?.material?.printTemperatureC ?? DEFAULT_PRINT_TEMP_C;
  const buildPlateTempC = instanceProfile?.material?.buildPlateTemperatureC ?? DEFAULT_BUILD_PLATE_TEMP_C;
  const ePerMm = extrusionPerMm(plan.settings, filamentDiameterMm);

  const warnings = [];
  if (plan.settings.beadWidth < 0.5 * nozzleDiameterMm || plan.settings.beadWidth > 2 * nozzleDiameterMm) {
    warnings.push({
      code: "line-width-outside-typical-range",
      message:
        `settings.beadWidth (${plan.settings.beadWidth}mm) is outside the typical viable range for a ${nozzleDiameterMm}mm nozzle ` +
        `(roughly 0.5x-2x nozzle diameter). This is general FDM guidance, not evidence specific to this machine — a value ` +
        "outside this range usually under- or over-extrudes rather than failing outright, so review it rather than treating this as a hard error.",
    });
  }

  const box = boundingBox(segments);
  const lines = [];
  let currentE = 0;
  let currentPos = null; // last emitted {x,y,z}
  let lastFeed = null;
  let printDistanceMm = 0;
  let travelDistanceMm = 0;

  function feedSuffix(feed) {
    if (feed === lastFeed) return "";
    lastFeed = feed;
    return ` F${feed}`;
  }

  function emitTravel(to, extraGap) {
    const zChanges = !currentPos || Math.abs(to.z - currentPos.z) > EPSILON_MM;
    const feed = zChanges ? Z_FEED : TRAVEL_FEED;
    lines.push(`G0${feedSuffix(feed)} X${gnum(to.x)} Y${gnum(to.y)} Z${gnum(to.z)}`);
    travelDistanceMm += extraGap;
    currentPos = to;
  }

  function emitRetract() {
    currentE -= RETRACT_MM;
    lines.push(`G1${feedSuffix(RETRACT_FEED)} E${gnum(currentE)}`);
  }

  function emitPrime() {
    currentE += RETRACT_MM;
    lines.push(`G1${feedSuffix(PRIME_FEED)} E${gnum(currentE)}`);
  }

  function emitPrint(to) {
    const segMm = distance3(currentPos, to);
    currentE += segMm * ePerMm;
    lines.push(`G1${feedSuffix(PRINT_FEED)} X${gnum(to.x)} Y${gnum(to.y)} Z${gnum(to.z)} E${gnum(currentE)}`);
    printDistanceMm += segMm;
    currentPos = to;
  }

  const T0 = "T0";
  lines.push(T0);
  lines.push("M82 ;absolute extrusion mode");
  lines.push("");
  lines.push("G92 E0");
  lines.push(`M109 S${gnum(printTempC, 1)}`);
  lines.push("G280 S1"); // Bed-leveling compensation activation — replicated from the reference sample; exact parameter semantics beyond "S1 was observed" are not independently confirmed.
  const safeLiftZ = Math.max(MIN_SAFE_LIFT_MM, box.maxZ + SAFE_LIFT_MARGIN_MM);
  lines.push(`G0 Z${gnum(safeLiftZ)}`);
  emitRetract();
  let retracted = true; // tracks whether the nozzle is currently sitting in its retracted E position, so travel never double-retracts.
  lines.push(`;LAYER_COUNT:${new Set(segments.map((s) => s.layer)).size}`);

  currentPos = { x: box.minX, y: box.minY, z: safeLiftZ }; // synthetic lead-in position; only its distance to the first real point is used, to decide the initial approach travel.
  let seenFirstLayer = false;
  let currentLayer = null;
  let hasPrintedAnything = false;

  for (const segment of segments) {
    if (segment.layer !== currentLayer) {
      currentLayer = segment.layer;
      lines.push(`;LAYER:${currentLayer}`);
      if (!seenFirstLayer) {
        seenFirstLayer = true;
        lines.push("M106 S255");
      }
    }
    lines.push(`;TYPE:${segment.family}`);

    const first = segment.points[0];
    const gapMm = distance3(currentPos, first);
    if (gapMm > EPSILON_MM) {
      // The very first travel (from the synthetic lead-in position to the first real print point)
      // is expected lead-in, not a gap the operation failed to design — don't warn on it.
      if (hasPrintedAnything) {
        warnings.push({
          code: "disjoint-transition",
          gapMm: Number(gapMm.toFixed(2)),
          message:
            `A ${gapMm.toFixed(2)} mm gap separates the previous printed point from "${segment.family}" (layer ${segment.layer}). ` +
            "This post-processor retracts, travels, and re-primes across it — but a gap this size was not designed as a " +
            "deliberate printed transition by the operation that produced it.",
          from: { x: currentPos.x, y: currentPos.y, z: currentPos.z },
          to: first,
        });
      }
      if (!retracted) {
        emitRetract();
        retracted = true;
      }
      emitTravel(first, gapMm);
      emitPrime();
      retracted = false;
    } else {
      currentPos = first;
    }

    for (let i = 1; i < segment.points.length; i++) {
      emitPrint(segment.points[i]);
      hasPrintedAnything = true;
    }
    // A single-point segment still needs its point registered as the current position.
    if (segment.points.length === 1) currentPos = first;
  }

  if (!retracted) emitRetract();
  lines.push("M107");
  lines.push("");
  lines.push("M82 ;absolute extrusion mode");
  lines.push("M104 S0");
  lines.push("M104 T1 S0");
  lines.push(";End of Gcode");

  const generatorVersion = "0.1.0";
  const materialVolumeMm3 = (currentE + RETRACT_MM) * (Math.PI * (filamentDiameterMm / 2) ** 2); // net extruded length (retractions cancel out) x filament cross-section
  const printTimeEstimateS = (printDistanceMm / PRINT_FEED) * 60 + (travelDistanceMm / TRAVEL_FEED) * 60;

  const header = renderHeader({
    box,
    materialVolumeMm3,
    printTimeEstimateS,
    nozzleDiameterMm,
    printTempC,
    buildPlateTempC,
    generatorVersion,
  });

  return {
    files: {
      "output.gcode": header + lines.join("\n") + "\n",
    },
    warnings,
  };
}
