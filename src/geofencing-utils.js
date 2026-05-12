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
 * Check if a coordinate is inside a rectangle defined by a road line + half-width buffer.
 * Uses a local 2-D projection (metres) to avoid dealing with spherical geometry.
 * @param {Object} coords - {lat, lng}
 * @param {Array}  line   - [{lat, lng}, {lat, lng}] road endpoints
 * @param {number} halfWidth - perpendicular buffer in metres (default 20)
 * @returns {boolean}
 */
function isWithinLineBoundingRect(coords, line, halfWidth) {
    if (!coords || !line || line.length < 2) return false;
    halfWidth = halfWidth || 20;

    // Check each consecutive segment — supports multi-point lines
    for (let i = 0; i < line.length - 1; i++) {
        const p1 = line[i], p2 = line[i + 1];
        const cosLat = Math.cos(((p1.lat + p2.lat) / 2) * Math.PI / 180);

        // Inline projection relative to p1 — avoids closure-over-loop-variable bug
        const bx = (p2.lng - p1.lng) * 111320 * cosLat;
        const by = (p2.lat - p1.lat) * 111320;
        const qx = (coords.lng - p1.lng) * 111320 * cosLat;
        const qy = (coords.lat - p1.lat) * 111320;

        const roadLen = Math.sqrt(bx * bx + by * by);
        if (roadLen === 0) continue;
        const ux = bx / roadLen, uy = by / roadLen;

        const along = qx * ux + qy * uy;
        const perp  = Math.abs(-qx * uy + qy * ux);

        if (along >= 0 && along <= roadLen && perp <= halfWidth) return true;
    }

    return false;
}

/**
 * Check if a coordinate is within a geofenced zone.
 * For line-type zones (zone.line defined) a rectangle buffer is used;
 * for circle-type zones the Haversine radius check is used.
 * @param {Object} coords - Coordinate to check {lat, lng}
 * @param {Object} zone   - Zone definition
 * @returns {boolean} True if coordinate is within the zone
 */
function isWithinGeofence(coords, zone) {
    if (!coords || !zone) {
        console.warn('[Geofencing] Invalid coordinates or zone provided');
        return false;
    }

    if (zone.line && zone.line.length >= 2) {
        return isWithinLineBoundingRect(coords, zone.line, zone.bufferMeters || 20);
    }

    if (!zone.center || !zone.radius) {
        console.warn('[Geofencing] Invalid coordinates or zone provided');
        return false;
    }

    const distance = calculateDistance(coords, zone.center);
    return distance <= zone.radius;
}

/**
 * Check if a coordinate is within any of the defined zones.
 * When multiple zones overlap, the zone whose center is nearest
 * to the coordinate wins (nearest-center-wins strategy).
 * @param {Object} coords - Coordinate to check {lat, lng}
 * @param {Array} zones - Array of zone definitions
 * @returns {Object|null} The best-matching zone, or null
 */
function findZoneForCoords(coords, zones) {
    if (!coords || !zones || !Array.isArray(zones)) {
        return null;
    }

    let bestZone = null;
    let bestDist = Infinity;

    for (const zone of zones) {
        if (isWithinGeofence(coords, zone)) {
            // For line zones use the center fallback; for circle zones use center directly
            const center = zone.center || (zone.line && zone.line.length >= 2
                ? { lat: (zone.line[0].lat + zone.line[zone.line.length - 1].lat) / 2,
                    lng: (zone.line[0].lng + zone.line[zone.line.length - 1].lng) / 2 }
                : null);
            if (!center) { return zone; } // no center to compare — return immediately
            const dist = calculateDistance(coords, center);
            if (dist < bestDist) {
                bestDist = dist;
                bestZone = zone;
            }
        }
    }

    return bestZone;
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

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateDistance,
        isWithinLineBoundingRect,
        isWithinGeofence,
        findZoneForCoords,
        validateZone,
        validateCoords
    };
}
