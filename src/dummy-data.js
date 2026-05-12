// ============================================================
// DUMMY DATA FOR GPS/GEOFENCING PARKING SYSTEM
// ============================================================
// Generates realistic dummy sessions using centralized config.
// Depends on: config.js, zones-config.js, session-utils.js
// (all must be loaded before this file in <script> tags)
// ============================================================

(function () {
// ---- Resolve dependencies (browser globals or Node require) ----
const _cfg = (typeof SP_CONFIG !== 'undefined') ? SP_CONFIG : (typeof require !== 'undefined' ? require('./config') : {});
const _zones = (typeof ZONE_DEFINITIONS !== 'undefined') ? ZONE_DEFINITIONS : (typeof require !== 'undefined' ? require('./zones-config').ZONE_DEFINITIONS : []);
const _outside = (typeof OUTSIDE_ZONE_SPECS !== 'undefined') ? OUTSIDE_ZONE_SPECS : (typeof require !== 'undefined' ? require('./zones-config').OUTSIDE_ZONE_SPECS : []);
const SU = (typeof SessionUtils !== 'undefined') ? SessionUtils : (typeof require !== 'undefined' ? require('./session-utils') : null);

const DEMO_CURRENT_TIME = Date.now();

// Use zone definitions from zones-config.js, add timestamps
const DUMMY_ZONES = _zones.map(z => ({
    ...z,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
}));

// ============================================================
// PAYMENT SESSIONS — Generated dynamically from config targets
// ============================================================

const DUMMY_PAYMENT_SESSIONS = [];
const TARGETS = _cfg.ZONE_ACTIVE_TARGETS || {};
const DUR_MIN = (_cfg.GENERATOR || {}).DURATION_MIN_MINUTES || 30;
const DUR_MAX = (_cfg.GENERATOR || {}).DURATION_MAX_MINUTES || 120;

// Helper: create a single session for a zone
function createSession(zoneId, vehicleId, startOffsetMinutes, durationMinutes) {
    let startTime = DEMO_CURRENT_TIME + (startOffsetMinutes * 60 * 1000);
    let endTime = startTime + (durationMinutes * 60 * 1000);
    const clamped = SU.clampToOperatingHours(startTime, endTime);
    startTime = clamped.startMs;
    endTime = clamped.endMs;
    durationMinutes = Math.round((endTime - startTime) / 60000);

    const zone = DUMMY_ZONES.find(z => z.id === zoneId);
    const loc = zone ? SU.locationForZone(zone) : { lat: 0, lng: 0 };
    const status = SU.computeStatus(startTime, endTime);

    return {
        id: `session_${SU.seededRandom().toString(36).substr(2, 9)}`,
        zone_id: zoneId,
        vehicle_id: vehicleId,
        lat: loc.lat,
        lng: loc.lng,
        start_time: startTime,
        end_time: endTime,
        duration_minutes: durationMinutes,
        status: status,
        is_compliant: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
}

// ---- Generate active sessions per zone from config targets ----
let vehCounter = 1;
Object.keys(TARGETS).forEach(zoneId => {
    const count = TARGETS[zoneId];
    for (let i = 0; i < count; i++) {
        const startOffset = -(5 + Math.floor(SU.seededRandom() * 55)); // -5 to -60 min ago
        const duration = DUR_MIN + Math.floor(SU.seededRandom() * (DUR_MAX - DUR_MIN));
        DUMMY_PAYMENT_SESSIONS.push(createSession(zoneId, `VEH_${String(vehCounter).padStart(3, '0')}`, startOffset, duration));
        vehCounter++;
    }
});

// ---- Outside-zone sessions (paid, but GPS outside any geofence) ----
_outside.forEach(o => {
    let startTime = DEMO_CURRENT_TIME + (o.start * 60 * 1000);
    let endTime = startTime + (o.duration * 60 * 1000);
    const clamped = SU.clampToOperatingHours(startTime, endTime);
    startTime = clamped.startMs;
    endTime = clamped.endMs;
    const dur = Math.round((endTime - startTime) / 60000);
    DUMMY_PAYMENT_SESSIONS.push({
        id: `session_${SU.seededRandom().toString(36).substr(2, 9)}`,
        vehicle_id: o.vehicleId,
        lat: o.lat,
        lng: o.lng,
        zone_id: null,
        start_time: startTime,
        end_time: endTime,
        duration_minutes: dur,
        status: SU.computeStatus(startTime, endTime),
        is_compliant: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    });
});

// ---- Expired sessions (completed) ----
for (let i = 0; i < 8; i++) {
    const session = createSession('zone_ss15_4', `VEH_EXP_${i + 1}`, -120, 60);
    session.status = 'completed';
    DUMMY_PAYMENT_SESSIONS.push(session);
}

// ---- Future sessions (upcoming) ----
for (let i = 0; i < 5; i++) {
    const session = createSession('zone_ss15_8', `VEH_FUT_${i + 1}`, 30, 60);
    session.status = 'upcoming';
    DUMMY_PAYMENT_SESSIONS.push(session);
}
// ============================================================
// MANUAL TEST SESSIONS
// ============================================================
// createManualSession(vehicle_id, lat, lng, startOffsetMinutes, durationMinutes)
// Examples:
//   DUMMY_PAYMENT_SESSIONS.push(createManualSession('MY_CAR', 3.07650, 101.58020, -10, 60));
//   DUMMY_PAYMENT_SESSIONS.push(createManualSession('TEST_OUTSIDE', 3.07200, 101.57500, -5, 30));
// ============================================================

function createManualSession(vehicleId, lat, lng, startOffsetMinutes, durationMinutes) {
    let startTime = DEMO_CURRENT_TIME + (startOffsetMinutes * 60 * 1000);
    let endTime = startTime + (durationMinutes * 60 * 1000);
    const clamped = SU.clampToOperatingHours(startTime, endTime);
    startTime = clamped.startMs;
    endTime = clamped.endMs;
    durationMinutes = Math.round((endTime - startTime) / 60000);
    return {
        id:              `manual_${vehicleId}_${Date.now()}`,
        vehicle_id:      vehicleId,
        lat:             lat,
        lng:             lng,
        zone_id:         null,
        start_time:      startTime,
        end_time:        endTime,
        duration_minutes: durationMinutes,
        status:          'active',
        is_compliant:    false,
        created_at:      new Date().toISOString(),
        updated_at:      new Date().toISOString()
    };
}

// ---- Add your custom sessions below this line ----
// DUMMY_PAYMENT_SESSIONS.push(createManualSession('MY_CAR', 3.07650, 101.58020, -10, 60));

// ---- Exports ----
if (typeof window !== 'undefined') {
    window.DUMMY_ZONES = DUMMY_ZONES;
    window.DUMMY_PAYMENT_SESSIONS = DUMMY_PAYMENT_SESSIONS;
    window.DEMO_CURRENT_TIME = DEMO_CURRENT_TIME;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DUMMY_ZONES, DUMMY_PAYMENT_SESSIONS, DEMO_CURRENT_TIME };
}

})();
