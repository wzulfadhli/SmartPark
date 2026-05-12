// ============================================================
// SMARTPARK UI HELPERS — Shared Browser-Side Utilities
// ============================================================
// Consolidates duplicated helper functions used across
// dashboard.html, monitor.html, and map.html pages.
// Depends on: config.js, session-utils.js, geofencing-utils.js
// (all must be loaded before this file in <script> tags)
// ============================================================

(function (root) {
    // ---- Resolve dependencies ----
    var SU = (typeof SessionUtils !== 'undefined') ? SessionUtils : null;
    var _cfg = (typeof SP_CONFIG !== 'undefined') ? SP_CONFIG : {};
    var _thresholds = _cfg.COMPLIANCE_THRESHOLDS || { HIGH: 80, MEDIUM: 50 };

    // ---- toMillis: Firestore Timestamp / plain ms / Date → ms ----
    function toMillis(ts) {
        if (SU && SU.toMillis) return SU.toMillis(ts);
        if (ts && typeof ts === 'object') {
            if (typeof ts.toMillis === 'function') return ts.toMillis();
            if (ts._seconds !== undefined) return ts._seconds * 1000;
            if (ts.seconds !== undefined) return ts.seconds * 1000;
        }
        return ts;
    }

    // ---- isSessionActiveNow: paid AND within time window ----
    function isSessionActiveNow(s, now) {
        now = now || Date.now();
        var start = toMillis(s.start_time);
        var end = toMillis(s.end_time);
        return s.status === 'active' && now >= start && now <= end;
    }

    // ---- resolveSessionZone: GPS containment (not stored zone_id) ----
    function resolveSessionZone(session, zones) {
        if (session.lat != null && session.lng != null) {
            // Try findZoneForCoords first (geofencing-utils), fallback to compliance-utils alias
            var fn = (typeof findZoneForCoords === 'function') ? findZoneForCoords
                   : (typeof findZoneContainingLocation === 'function') ? findZoneContainingLocation
                   : null;
            if (fn) return fn({ lat: session.lat, lng: session.lng }, zones);
        }
        return null;
    }

    // ---- bucketActiveByZone: { zoneId → count } + totalActive ----
    function bucketActiveByZone(sessions, zones, now) {
        now = now || Date.now();
        var map = {};
        var total = 0;
        var outside = 0;
        (sessions || []).forEach(function (s) {
            if (!isSessionActiveNow(s, now)) return;
            total++;
            var z = resolveSessionZone(s, zones);
            if (z) map[z.id] = (map[z.id] || 0) + 1;
            else outside++;
        });
        return { activeByZone: map, totalActive: total, outsideCount: outside };
    }

    // ---- Status color hex ----
    var STATUS_COLORS = { green: '#10b981', orange: '#f59e0b', red: '#ef4444' };

    function getStatusColorHex(statusColor) {
        return STATUS_COLORS[statusColor] || '#6b7280';
    }

    // ---- Compliance style (used by map) ----
    function getComplianceStyle(complianceRate) {
        if (complianceRate >= _thresholds.HIGH)   return { color: 'var(--accent-success)', hex: '#10b981', text: 'High' };
        if (complianceRate >= _thresholds.MEDIUM)  return { color: 'var(--accent-warning)', hex: '#f59e0b', text: 'Medium' };
        return { color: 'var(--accent-danger)', hex: '#ef4444', text: 'Low' };
    }

    // ---- Compliance status color string (green/orange/red) ----
    function complianceStatusColor(rate) {
        if (rate >= _thresholds.HIGH) return 'green';
        if (rate >= _thresholds.MEDIUM) return 'orange';
        return 'red';
    }

    // ---- Session table filtering ----
    // Returns filtered array of sessions based on common filter controls.
    // opts: { zoneFilterValue, statusFilterValue, dateFilterValue, searchValue, zones, onlyActive }
    function filterSessions(sessions, opts) {
        var zones = opts.zones || [];
        var zoneVal = opts.zoneFilterValue || '';
        var statusVal = opts.statusFilterValue || '';
        var dateVal = opts.dateFilterValue || '';
        var searchVal = (opts.searchValue || '').trim().toLowerCase();
        var now = Date.now();

        return (sessions || []).filter(function (s) {
            // If onlyActive, pre-filter to truly-active
            if (opts.onlyActive && !isSessionActiveNow(s, now)) return false;

            // Zone filter
            if (zoneVal) {
                var containingZone = resolveSessionZone(s, zones);
                if (zoneVal === 'outside') {
                    if (containingZone) return false;
                } else if (!containingZone || containingZone.id !== zoneVal) {
                    return false;
                }
            }

            // Status filter
            if (statusVal && s.status !== statusVal) return false;

            // Date filter
            if (dateVal) {
                var d = new Date(toMillis(s.start_time));
                var sessionDate = d.getFullYear() + '-' +
                    String(d.getMonth() + 1).padStart(2, '0') + '-' +
                    String(d.getDate()).padStart(2, '0');
                if (sessionDate !== dateVal) return false;
            }

            // Search filter
            if (searchVal) {
                var hay = ((s.id || '') + ' ' + (s.vehicle_id || '')).toLowerCase();
                if (!hay.includes(searchVal)) return false;
            }

            return true;
        });
    }

    // ---- Populate a zone <select> dropdown ----
    function populateZoneFilter(selectEl, zones, preserveValue) {
        if (!selectEl) return;
        var current = preserveValue ? selectEl.value : '';
        selectEl.innerHTML = '<option value="">All Zones</option><option value="outside">Outside Zone</option>';
        (zones || []).forEach(function (z) {
            selectEl.innerHTML += '<option value="' + z.id + '">' + z.name + '</option>';
        });
        if (current) selectEl.value = current;
    }

    // ---- Dummy data bootstrap (shared across all pages) ----
    function bootstrapDummyData(pageLabel) {
        if (typeof USE_DUMMY_DATA !== 'undefined' && USE_DUMMY_DATA) {
            if (typeof DUMMY_ZONES !== 'undefined') {
                root.ZONES = DUMMY_ZONES;
                console.log('[' + pageLabel + '] Loaded dummy zones:', root.ZONES.length);
            }
            if (typeof DUMMY_PAYMENT_SESSIONS !== 'undefined') {
                root.PAYMENT_SESSIONS = DUMMY_PAYMENT_SESSIONS;
                console.log('[' + pageLabel + '] Loaded dummy payment sessions:', root.PAYMENT_SESSIONS.length);
            }
        } else {
            console.log('[' + pageLabel + '] Waiting for Firebase data (USE_DUMMY_DATA = false)');
        }
    }

    // ---- Format helpers (delegate to SessionUtils if available) ----
    function formatDate(ms) {
        return new Date(toMillis(ms)).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
    }
    function formatTime(ms) {
        return new Date(toMillis(ms)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // ---- Status badge HTML ----
    function statusBadgeHtml(status) {
        var map = {
            active:    '<span class="badge bg-primary">Active</span>',
            upcoming:  '<span class="badge bg-secondary">Upcoming</span>',
            completed: '<span class="badge bg-success">Completed</span>',
            cancelled: '<span class="badge bg-warning">Cancelled</span>'
        };
        return map[status] || '<span class="badge bg-light text-dark">' + status + '</span>';
    }

    // ---- Expose ----
    var UIHelpers = {
        toMillis: toMillis,
        isSessionActiveNow: isSessionActiveNow,
        resolveSessionZone: resolveSessionZone,
        bucketActiveByZone: bucketActiveByZone,
        getStatusColorHex: getStatusColorHex,
        getComplianceStyle: getComplianceStyle,
        complianceStatusColor: complianceStatusColor,
        filterSessions: filterSessions,
        populateZoneFilter: populateZoneFilter,
        bootstrapDummyData: bootstrapDummyData,
        formatDate: formatDate,
        formatTime: formatTime,
        statusBadgeHtml: statusBadgeHtml,
        STATUS_COLORS: STATUS_COLORS
    };

    if (typeof window !== 'undefined') {
        root.UIHelpers = UIHelpers;
        // Convenience globals (backward compat with inline page code)
        root.toMillis = toMillis;
        root.isSessionActiveNow = isSessionActiveNow;
        root.resolveSessionZone = resolveSessionZone;
        root.bucketActiveByZone = bucketActiveByZone;
        root.getStatusColorHex = getStatusColorHex;
        root.getComplianceStyle = getComplianceStyle;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = UIHelpers;
    }
})(typeof self !== 'undefined' ? self : this);
