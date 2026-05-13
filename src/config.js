// ============================================================
// SMARTPARK CENTRALIZED CONFIG
// ============================================================
// Single source of truth for all configurable values across the
// app (browser pages, dummy data, data generator, seed scripts).
//
// Change a value here and it propagates everywhere.
// Works in both Browser (window.SP_CONFIG) and Node (module.exports).
// ============================================================

(function (root) {
    const SP_CONFIG = {
        // ---- App ----
        APP_VERSION: '2.2.0',
        USE_DUMMY_DATA: true,  // true → generate dummy sessions in-browser
        USE_DUMMY_ZONES: false, // false → load zones from Firestore; true → use zones-config.js
        DEFAULT_TARGET_OCCUPANCY: 0.65, // fallback if zone has no targetOccupancy field

        // ---- Operating Hours (parking payment window) ----
        OPERATING_HOURS: {
            START_HOUR: 8,   // 8:00 AM
            END_HOUR:   18,  // 6:00 PM
        },

        // ---- Compliance Thresholds (% active sessions / totalLots) ----
        COMPLIANCE_THRESHOLDS: {
            HIGH:   80,  // >= 80% = Green
            MEDIUM: 50,  // 50-79% = Orange, < 50% = Red
            LOW:     0,
        },

        // ---- Firestore Collection Names ----
        COLLECTIONS: {
            ZONES:                    'zones',
            EXTERNAL_PAYMENT_SESSIONS:'external_payment_sessions',
            PARKING_SESSIONS:         'parking_sessions',
            COMPLIANCE_SNAPSHOTS:     'compliance_snapshots',
            SYNC_RUNS:                'sync_runs',
            DAILY_SUMMARY:            'daily_summary',
        },

        // ---- Data Generator (scripts/data-generator.js) ----
        GENERATOR: {
            SESSIONS_PER_BATCH:    5,
            MAX_TOTAL_SESSIONS:    300,
            OUTSIDE_PROBABILITY:   0.10, // 10% of generated sessions are outside-zone
            MIN_SESSION_MINUTES:   5,    // minimum clamped duration
            DURATION_MIN_MINUTES:  30,
            DURATION_MAX_MINUTES:  120,
        },

        // ---- Active Sessions per Zone (used by data-generator + dummy-data) ----
        ZONE_ACTIVE_TARGETS: {
            'zone_ss15_4':       35,  // 70% of 50  = Orange
            'zone_ss15_8':       38,  // 95% of 40  = Green
            'zone_usj10_taipan': 45,  // 37.5% of 120 = Red
            'zone_ss16_1':       60,  // 80% of 75  = Green
            'zone_ss17_1e':      24,  // 60% of 40  = Orange
            'zone_ss17_1b':       5,  // 17% of 30  = Red
        },

        // ---- Geofencing Defaults ----
        GEOFENCE: {
            DEFAULT_BUFFER_METERS:    20,   // line-zone half-width
            LOCATION_RADIUS_FACTOR:   0.8,  // generated points stay within 80% of radius
            OUTSIDE_OFFSET_MIN_M:     20,   // outside-zone payer placement (min)
            OUTSIDE_OFFSET_MAX_M:    100,   // outside-zone payer placement (max)
        },

        // ---- UI Refresh Intervals (ms) ----
        UI: {
            MONITOR_REFRESH_MS:  30000,
            SHELL_THEME_KEY:     'theme',
        },

        // ---- Firebase Configuration ----
        FIREBASE: {
            apiKey:            'AIzaSyDEyDj-bW8rRgaivvfNPVub8AfWMDpbWdY',
            authDomain:        'gpark-9eed8.firebaseapp.com',
            projectId:         'gpark-9eed8',
            storageBucket:     'gpark-9eed8.firebasestorage.app',
            messagingSenderId: '517710435374',
            appId:             '1:517710435374:web:7ca16215d5ab4422243bbf',
        },
    };

    // Browser
    if (typeof window !== 'undefined') {
        root.SP_CONFIG = SP_CONFIG;
        // Backward-compat globals (existing code references these directly)
        root.COMPLIANCE_THRESHOLDS = SP_CONFIG.COMPLIANCE_THRESHOLDS;
        root.COLLECTIONS = SP_CONFIG.COLLECTIONS;
    }
    // Node
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SP_CONFIG;
    }
})(typeof self !== 'undefined' ? self : this);
