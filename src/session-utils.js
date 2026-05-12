// ============================================================
// SMARTPARK SESSION UTILITIES — Shared Helpers
// ============================================================
// Consolidates helpers that were duplicated across dummy-data.js,
// data-generator.js, firebase-seed.js, dashboard.html, monitor.html.
//
// Depends on: config.js (SP_CONFIG)
// Works in both Browser (window.SessionUtils) and Node (module.exports).
// ============================================================

(function (root) {
    // ---- Resolve config (Node require or browser global) ----
    function getConfig() {
        if (typeof require !== 'undefined') {
            try { return require('./config'); } catch (e) { /* fall through */ }
        }
        if (typeof SP_CONFIG !== 'undefined') return SP_CONFIG;
        // Fallback defaults if config not loaded yet
        return {
            OPERATING_HOURS: { START_HOUR: 8, END_HOUR: 18 },
            GENERATOR: { MIN_SESSION_MINUTES: 5, OUTSIDE_OFFSET_MIN_M: 20, OUTSIDE_OFFSET_MAX_M: 100 },
            GEOFENCE: { DEFAULT_BUFFER_METERS: 20, LOCATION_RADIUS_FACTOR: 0.8, OUTSIDE_OFFSET_MIN_M: 20, OUTSIDE_OFFSET_MAX_M: 100 },
        };
    }

    // ---- Seeded pseudo-random ----
    let _seed = 12345;
    function seededRandom() {
        _seed = (_seed * 16807 + 0) % 2147483647;
        return (_seed - 1) / 2147483646;
    }
    function resetSeed(val) { _seed = val || 12345; }

    // ---- Timestamp helpers ----
    function toMillis(ts) {
        if (ts && typeof ts === 'object') {
            if (typeof ts.toMillis === 'function') return ts.toMillis();
            if (ts._seconds !== undefined) return ts._seconds * 1000;
            if (ts.seconds !== undefined) return ts.seconds * 1000;
        }
        return ts;
    }

    // ---- Operating hours ----
    function getTodayAtHour(hour) {
        var d = new Date();
        d.setHours(hour, 0, 0, 0);
        return d.getTime();
    }

    function clampToOperatingHours(startMs, endMs) {
        var cfg = getConfig();
        var opStart = getTodayAtHour(cfg.OPERATING_HOURS.START_HOUR);
        var opEnd = getTodayAtHour(cfg.OPERATING_HOURS.END_HOUR);
        if (startMs < opStart) startMs = opStart;
        if (endMs > opEnd) endMs = opEnd;
        var minMs = (cfg.GENERATOR ? cfg.GENERATOR.MIN_SESSION_MINUTES : 5) * 60 * 1000;
        if (startMs >= endMs) {
            endMs = startMs + minMs;
        }
        return { startMs: startMs, endMs: endMs };
    }

    function isWithinOperatingHours(nowMs) {
        var cfg = getConfig();
        var opStart = getTodayAtHour(cfg.OPERATING_HOURS.START_HOUR);
        var opEnd = getTodayAtHour(cfg.OPERATING_HOURS.END_HOUR);
        nowMs = nowMs || Date.now();
        return nowMs >= opStart && nowMs <= opEnd;
    }

    // ---- Session status ----
    function computeStatus(startMs, endMs) {
        var nowMs = Date.now();
        if (nowMs < startMs) return 'upcoming';
        if (nowMs > endMs) return 'completed';
        return 'active';
    }

    function isSessionActiveNow(session, nowMs) {
        nowMs = nowMs || Date.now();
        var start = toMillis(session.start_time);
        var end = toMillis(session.end_time);
        return session.status === 'active' && nowMs >= start && nowMs <= end;
    }

    // ---- Location generation ----
    function locationForZone(zone) {
        var cfg = getConfig();
        var bufFactor = cfg.GEOFENCE ? cfg.GEOFENCE.LOCATION_RADIUS_FACTOR : 0.8;
        var defaultBuf = cfg.GEOFENCE ? cfg.GEOFENCE.DEFAULT_BUFFER_METERS : 20;

        if (zone.line && zone.line.length >= 2) {
            var buf = (zone.bufferMeters || defaultBuf) * bufFactor;
            var segIdx = Math.floor(seededRandom() * (zone.line.length - 1));
            var p1 = zone.line[segIdx], p2 = zone.line[segIdx + 1];
            var t = seededRandom();
            var baseLat = p1.lat + t * (p2.lat - p1.lat);
            var baseLng = p1.lng + t * (p2.lng - p1.lng);
            var dLat = p2.lat - p1.lat, dLng = p2.lng - p1.lng;
            var len = Math.sqrt(dLat * dLat + dLng * dLng);
            var cosLat = Math.cos(baseLat * Math.PI / 180);
            var perpLat = (-dLng / len) * (buf / 111320);
            var perpLng = (dLat / len) * (buf / (111320 * cosLat));
            var side = (seededRandom() < 0.5 ? 1 : -1) * seededRandom();
            return { lat: baseLat + perpLat * side, lng: baseLng + perpLng * side };
        }
        var radius = zone.radius || 100;
        var angle = seededRandom() * 2 * Math.PI;
        var dist = Math.sqrt(seededRandom()) * radius * bufFactor;
        var dlat = (dist * Math.cos(angle)) / 111320;
        var dlng = (dist * Math.sin(angle)) / (111320 * Math.cos(zone.center.lat * Math.PI / 180));
        return { lat: zone.center.lat + dlat, lng: zone.center.lng + dlng };
    }

    function outsideLocationForZone(zone) {
        var cfg = getConfig();
        var minM = cfg.GEOFENCE ? cfg.GEOFENCE.OUTSIDE_OFFSET_MIN_M : 20;
        var maxM = cfg.GEOFENCE ? cfg.GEOFENCE.OUTSIDE_OFFSET_MAX_M : 100;

        if (zone.line && zone.line.length >= 2) {
            var p1 = zone.line[0], p2 = zone.line[zone.line.length - 1];
            var midLat = (p1.lat + p2.lat) / 2;
            var midLng = (p1.lng + p2.lng) / 2;
            var cosLat = Math.cos(midLat * Math.PI / 180);
            var beyond = minM + Math.floor(seededRandom() * (maxM - minM));
            var bearing = seededRandom() * 360;
            var rad = (bearing * Math.PI) / 180;
            var dLat = (beyond * Math.cos(rad)) / 111320;
            var dLng = (beyond * Math.sin(rad)) / (111320 * cosLat);
            return { lat: midLat + dLat, lng: midLng + dLng };
        }
        var radius = zone.radius || 100;
        var beyond2 = minM + Math.floor(seededRandom() * (maxM - minM));
        var angle = seededRandom() * 2 * Math.PI;
        var dlat = (beyond2 * Math.cos(angle)) / 111320;
        var dlng = (beyond2 * Math.sin(angle)) / (111320 * Math.cos(zone.center.lat * Math.PI / 180));
        return { lat: zone.center.lat + dlat, lng: zone.center.lng + dlng };
    }

    // ---- Vehicle ID ----
    function randomVehicleId(n) {
        if (n !== undefined) return 'VEH_' + String(n).padStart(3, '0');
        var num = Math.floor(seededRandom() * 900) + 100;
        return 'VEH_' + num;
    }

    // ---- Date formatting ----
    function formatDate(ms) {
        var d = new Date(toMillis(ms));
        return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function formatTime(ms) {
        var d = new Date(toMillis(ms));
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function toDateFilterString(ms) {
        var d = new Date(toMillis(ms));
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    // ---- Status badge HTML ----
    function statusBadgeHtml(status) {
        var map = {
            active:    '<span class="badge bg-primary">Active</span>',
            upcoming:  '<span class="badge bg-secondary">Upcoming</span>',
            completed: '<span class="badge bg-success">Completed</span>',
            cancelled: '<span class="badge bg-warning">Cancelled</span>',
        };
        return map[status] || '<span class="badge bg-dark">' + status + '</span>';
    }

    // ---- Public API ----
    var SessionUtils = {
        seededRandom: seededRandom,
        resetSeed: resetSeed,
        toMillis: toMillis,
        getTodayAtHour: getTodayAtHour,
        clampToOperatingHours: clampToOperatingHours,
        isWithinOperatingHours: isWithinOperatingHours,
        computeStatus: computeStatus,
        isSessionActiveNow: isSessionActiveNow,
        locationForZone: locationForZone,
        outsideLocationForZone: outsideLocationForZone,
        randomVehicleId: randomVehicleId,
        formatDate: formatDate,
        formatTime: formatTime,
        toDateFilterString: toDateFilterString,
        statusBadgeHtml: statusBadgeHtml,
    };

    // Browser
    if (typeof window !== 'undefined') {
        root.SessionUtils = SessionUtils;
        // Convenience globals so existing inline code doesn't break
        root.toMillis = toMillis;
        root.computeStatus = computeStatus;
        root.isSessionActiveNow = isSessionActiveNow;
        root.statusBadgeHtml = statusBadgeHtml;
    }
    // Node
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SessionUtils;
    }
})(typeof self !== 'undefined' ? self : this);
