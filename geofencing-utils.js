// ============================================================
// GEOFENCING UTILITY MODULE
// ============================================================
// This module provides reusable geofencing functions for the
// GPS-based parking system. It replaces the old sensor-based
// detection logic with location-based zone checking.
// ============================================================

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {Object} coord1 - First coordinate {lat, lng}
 * @param {Object} coord2 - Second coordinate {lat, lng}
 * @returns {number} Distance in meters
 */
function calculateDistance(coord1, coord2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = coord1.lat * Math.PI / 180;
    const φ2 = coord2.lat * Math.PI / 180;
    const Δφ = (coord2.lat - coord1.lat) * Math.PI / 180;
    const Δλ = (coord2.lng - coord1.lng) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Check if a coordinate is within a geofenced zone
 * @param {Object} coords - Coordinate to check {lat, lng}
 * @param {Object} zone - Zone definition {center: {lat, lng}, radius: number}
 * @returns {boolean} True if coordinate is within the zone
 */
function isWithinGeofence(coords, zone) {
    if (!coords || !zone || !zone.center || !zone.radius) {
        console.warn('[Geofencing] Invalid coordinates or zone provided');
        return false;
    }

    const distance = calculateDistance(coords, zone.center);
    return distance <= zone.radius;
}

/**
 * Check if a coordinate is within any of the defined zones
 * @param {Object} coords - Coordinate to check {lat, lng}
 * @param {Array} zones - Array of zone definitions
 * @returns {Object|null} The zone object if within any zone, null otherwise
 */
function findZoneForCoords(coords, zones) {
    if (!coords || !zones || !Array.isArray(zones)) {
        return null;
    }

    for (const zone of zones) {
        if (isWithinGeofence(coords, zone)) {
            return zone;
        }
    }

    return null;
}

/**
 * Validate zone definition structure
 * @param {Object} zone - Zone object to validate
 * @returns {boolean} True if zone is valid
 */
function validateZone(zone) {
    return (
        zone &&
        typeof zone === 'object' &&
        zone.id &&
        typeof zone.id === 'string' &&
        zone.name &&
        typeof zone.name === 'string' &&
        zone.center &&
        typeof zone.center.lat === 'number' &&
        typeof zone.center.lng === 'number' &&
        typeof zone.radius === 'number' &&
        zone.radius > 0 &&
        typeof zone.totalLots === 'number' &&
        zone.totalLots > 0
    );
}

/**
 * Validate coordinate structure
 * @param {Object} coords - Coordinate object to validate
 * @returns {boolean} True if coordinate is valid
 */
function validateCoords(coords) {
    return (
        coords &&
        typeof coords === 'object' &&
        typeof coords.lat === 'number' &&
        coords.lat >= -90 && coords.lat <= 90 &&
        typeof coords.lng === 'number' &&
        coords.lng >= -180 && coords.lng <= 180
    );
}

// ============================================================
// SAMPLE ZONE DEFINITIONS
// ============================================================
// These are example geofenced parking zones. In production,
// these would be loaded from Firestore or a configuration file.
// ============================================================

const SAMPLE_ZONES = [
    {
        id: 'zone_ss15_4',
        name: 'Jalan SS15/4',
        center: { lat: 3.0765, lng: 101.5890 },
        radius: 150, // meters
        totalLots: 50,
        createdAt: new Date().toISOString()
    },
    {
        id: 'zone_ss15_8',
        name: 'Jalan SS15/8',
        center: { lat: 3.0750, lng: 101.5895 },
        radius: 120,
        totalLots: 40,
        createdAt: new Date().toISOString()
    },
    {
        id: 'zone_usj10_taipan',
        name: 'USJ 10 Taipan',
        center: { lat: 3.0485, lng: 101.5850 },
        radius: 200,
        totalLots: 120,
        createdAt: new Date().toISOString()
    },
    {
        id: 'zone_ss16_1',
        name: 'Jalan SS16/1',
        center: { lat: 3.0820, lng: 101.5865 },
        radius: 180,
        totalLots: 75,
        createdAt: new Date().toISOString()
    }
];

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateDistance,
        isWithinGeofence,
        findZoneForCoords,
        validateZone,
        validateCoords,
        SAMPLE_ZONES
    };
}
