// ============================================================
// DUMMY DATA FOR GPS/GEOFENCING PARKING SYSTEM
// ============================================================
// Generates realistic dummy sessions using centralized config.
// Depends on: config.js, zones-config.js, session-utils.js
// (all must be loaded before this file in <script> tags)
//
// Public API:
//   DummyData.generateSessions(zones, cfg)  — (re)generate sessions
//   DummyData.DEMO_CURRENT_TIME
//
// Also callable at load time for backward compat when zones
// are available immediately (USE_DUMMY_ZONES = true).
// ============================================================

(function (root) {
// ---- Resolve dependencies (browser globals or Node require) ----
var _cfg = (typeof SP_CONFIG !== 'undefined') ? SP_CONFIG : (typeof require !== 'undefined' ? require('./config') : {});
var _zones = (typeof ZONE_DEFINITIONS !== 'undefined') ? ZONE_DEFINITIONS : (typeof require !== 'undefined' ? require('./zones-config').ZONE_DEFINITIONS : []);
var _outside = (typeof OUTSIDE_ZONE_SPECS !== 'undefined') ? OUTSIDE_ZONE_SPECS : (typeof require !== 'undefined' ? require('./zones-config').OUTSIDE_ZONE_SPECS : []);
var SU = (typeof SessionUtils !== 'undefined') ? SessionUtils : (typeof require !== 'undefined' ? require('./session-utils') : null);

var DEMO_CURRENT_TIME = Date.now();

// ---- Internal: create a single session for a zone ----
function createSession(zone, vehicleId, startOffsetMinutes, durationMinutes) {
    var startTime = DEMO_CURRENT_TIME + (startOffsetMinutes * 60 * 1000);
    var endTime = startTime + (durationMinutes * 60 * 1000);
    var clamped = SU.clampToOperatingHours(startTime, endTime);
    startTime = clamped.startMs;
    endTime = clamped.endMs;
    durationMinutes = Math.round((endTime - startTime) / 60000);

    var loc = zone ? SU.locationForZone(zone) : { lat: 0, lng: 0 };
    var status = SU.computeStatus(startTime, endTime);

    return {
        id: 'session_' + SU.seededRandom().toString(36).substr(2, 9),
        zone_id: zone ? zone.id : null,
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

// ============================================================
// generateSessions(zones, cfg)
// ============================================================
// Can be called multiple times (e.g. when Firestore zones arrive).
// Returns { zones: [...], sessions: [...] } and also sets the
// window globals for backward compat.
// ============================================================
function generateSessions(zones, cfg) {
    cfg = cfg || _cfg;
    zones = zones || _zones;
    var seed = (cfg && cfg.seed) ? cfg.seed : 12345;
    SU.resetSeed(seed);

    var defaultOcc = cfg.DEFAULT_TARGET_OCCUPANCY || 0.65;
    var legacyTargets = cfg.ZONE_ACTIVE_TARGETS || {};
    var DUR_MIN = (cfg.GENERATOR || {}).DURATION_MIN_MINUTES || 30;
    var DUR_MAX = (cfg.GENERATOR || {}).DURATION_MAX_MINUTES || 120;
    var outsideSpecs = (typeof OUTSIDE_ZONE_SPECS !== 'undefined') ? OUTSIDE_ZONE_SPECS : _outside;

    // Add timestamps to zones
    var dummyZones = zones.map(function (z) {
        return Object.assign({}, z, {
            createdAt: z.createdAt || new Date().toISOString(),
            updatedAt: z.updatedAt || new Date().toISOString()
        });
    });

    var sessions = [];
    var vehCounter = 1;

    // ---- Active sessions per zone ----
    dummyZones.forEach(function (zone) {
        // Priority: zone.targetOccupancy (Firestore) → legacy map → default
        var target;
        if (zone.targetOccupancy !== undefined) {
            target = Math.floor(zone.totalLots * zone.targetOccupancy);
        } else if (legacyTargets[zone.id] !== undefined) {
            target = legacyTargets[zone.id];
        } else {
            target = Math.floor(zone.totalLots * defaultOcc);
        }

        for (var i = 0; i < target; i++) {
            var startOffset = -(5 + Math.floor(SU.seededRandom() * 55));
            var duration = DUR_MIN + Math.floor(SU.seededRandom() * (DUR_MAX - DUR_MIN));
            sessions.push(createSession(zone, 'VEH_' + String(vehCounter).padStart(3, '0'), startOffset, duration));
            vehCounter++;
        }
    });

    // ---- Outside-zone sessions ----
    outsideSpecs.forEach(function (o) {
        var startTime = DEMO_CURRENT_TIME + (o.start * 60 * 1000);
        var endTime = startTime + (o.duration * 60 * 1000);
        var clamped = SU.clampToOperatingHours(startTime, endTime);
        startTime = clamped.startMs;
        endTime = clamped.endMs;
        var dur = Math.round((endTime - startTime) / 60000);
        sessions.push({
            id: 'session_' + SU.seededRandom().toString(36).substr(2, 9),
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
    var firstZone = dummyZones[0];
    if (firstZone) {
        for (var i = 0; i < 8; i++) {
            var session = createSession(firstZone, 'VEH_EXP_' + (i + 1), -120, 60);
            session.status = 'completed';
            sessions.push(session);
        }
    }

    // ---- Future sessions (upcoming) ----
    var secondZone = dummyZones[1];
    if (secondZone) {
        for (var j = 0; j < 5; j++) {
            var futSession = createSession(secondZone, 'VEH_FUT_' + (j + 1), 30, 60);
            futSession.status = 'upcoming';
            sessions.push(futSession);
        }
    }

    // ---- Set globals for backward compat ----
    if (typeof window !== 'undefined') {
        window.DUMMY_ZONES = dummyZones;
        window.DUMMY_PAYMENT_SESSIONS = sessions;
        window.DEMO_CURRENT_TIME = DEMO_CURRENT_TIME;
    }

    console.log('[DummyData] Generated ' + sessions.length + ' sessions for ' + dummyZones.length + ' zones');
    return { zones: dummyZones, sessions: sessions };
}

// ---- Auto-generate at load if zones are available (backward compat) ----
var useDummyZones = _cfg.USE_DUMMY_ZONES !== undefined ? _cfg.USE_DUMMY_ZONES : true;
if (useDummyZones && _zones && _zones.length) {
    generateSessions(_zones, _cfg);
}

// ---- Public API ----
var DummyData = {
    generateSessions: generateSessions,
    DEMO_CURRENT_TIME: DEMO_CURRENT_TIME
};

// Browser
if (typeof window !== 'undefined') {
    root.DummyData = DummyData;
    // Legacy globals (set by generateSessions when called)
}
// Node
if (typeof module !== 'undefined' && module.exports) {
    // For Node tests, auto-generate with defaults
    var result = generateSessions(_zones, _cfg);
    module.exports = {
        DummyData: DummyData,
        DUMMY_ZONES: result.zones,
        DUMMY_PAYMENT_SESSIONS: result.sessions,
        DEMO_CURRENT_TIME: DEMO_CURRENT_TIME
    };
}

})(typeof self !== 'undefined' ? self : this);
