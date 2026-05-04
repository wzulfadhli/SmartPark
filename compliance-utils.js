// ============================================================
// COMPLIANCE CALCULATION MODULE
// ============================================================
// This module provides pure functions for calculating parking
// compliance rates based on active payment sessions within
// geofenced zones. This replaces the old sensor-based occupancy
// detection with payment-based compliance tracking.
// ============================================================

/**
 * Calculate compliance rate for a zone
 * This is a pure function - it only depends on its inputs and has no side effects
 * @param {number} activeSessions - Number of active paid sessions in the zone
 * @param {number} totalLots - Total number of parking lots in the zone
 * @returns {number} Compliance rate as a percentage (0-100)
 */
function calculateComplianceRate(activeSessions, totalLots) {
    if (typeof activeSessions !== 'number' || typeof totalLots !== 'number') {
        console.warn('[Compliance] Invalid input types');
        return 0;
    }

    if (totalLots <= 0) {
        console.warn('[Compliance] Total lots must be greater than 0');
        return 0;
    }

    if (activeSessions < 0) {
        console.warn('[Compliance] Active sessions cannot be negative');
        return 0;
    }

    const rate = (activeSessions / totalLots) * 100;
    return Math.min(100, Math.max(0, rate)); // Clamp between 0 and 100
}

/**
 * Determine compliance status color based on rate
 * This is a pure function - it only depends on its inputs
 * @param {number} complianceRate - Compliance rate percentage (0-100)
 * @param {Object} thresholds - Threshold configuration {HIGH, MEDIUM, LOW}
 * @returns {string} Status color: 'green', 'orange', or 'red'
 */
function getComplianceStatusColor(complianceRate, thresholds) {
    const { HIGH = 80, MEDIUM = 50 } = thresholds || {};

    if (typeof complianceRate !== 'number') {
        console.warn('[Compliance] Invalid compliance rate');
        return 'red';
    }

    if (complianceRate >= HIGH) {
        return 'green';
    } else if (complianceRate >= MEDIUM) {
        return 'orange';
    } else {
        return 'red';
    }
}

/**
 * Get compliance status label
 * This is a pure function - it only depends on its inputs
 * @param {string} statusColor - Status color ('green', 'orange', 'red')
 * @returns {string} Human-readable status label
 */
function getComplianceStatusLabel(statusColor) {
    const labels = {
        green: 'High Compliance',
        orange: 'Medium Compliance',
        red: 'Low Compliance'
    };

    return labels[statusColor] || 'Unknown';
}

/**
 * Calculate compliance snapshot for a zone
 * This is a pure function that combines all compliance calculations
 * @param {number} activeSessions - Number of active paid sessions
 * @param {number} totalLots - Total parking lots in zone
 * @param {Object} thresholds - Threshold configuration
 * @returns {Object} Complete compliance snapshot
 */
function calculateComplianceSnapshot(activeSessions, totalLots, thresholds) {
    const complianceRate = calculateComplianceRate(activeSessions, totalLots);
    const statusColor = getComplianceStatusColor(complianceRate, thresholds);
    const statusLabel = getComplianceStatusLabel(statusColor);

    return {
        activeSessions,
        totalLots,
        complianceRate: Math.round(complianceRate * 10) / 10, // Round to 1 decimal
        statusColor,
        statusLabel,
        timestamp: Date.now()
    };
}

/**
 * Filter active payment sessions for a specific zone and time
 * This is a pure function - it only depends on its inputs
 * @param {Array} sessions - Array of payment session objects
 * @param {string} zoneId - Zone ID to filter by
 * @param {number} currentTime - Current timestamp in milliseconds
 * @returns {Array} Filtered active sessions for the zone
 */
function getActiveSessionsForZone(sessions, zoneId, currentTime) {
    if (!Array.isArray(sessions)) {
        return [];
    }

    return sessions.filter(session => {
        // Check if session belongs to the zone
        if (session.zoneId !== zoneId) {
            return false;
        }

        // Check if session is active (current time is between start and end)
        const isActive = currentTime >= session.startTime && currentTime <= session.endTime;

        return isActive && session.status === 'active';
    });
}

/**
 * Calculate compliance for multiple zones
 * This is a pure function that processes multiple zones at once
 * @param {Array} sessions - Array of all payment session objects
 * @param {Array} zones - Array of zone definitions
 * @param {number} currentTime - Current timestamp in milliseconds
 * @param {Object} thresholds - Threshold configuration
 * @returns {Array} Array of compliance snapshots for each zone
 */
function calculateComplianceForAllZones(sessions, zones, currentTime, thresholds) {
    if (!Array.isArray(zones)) {
        return [];
    }

    return zones.map(zone => {
        const activeSessions = getActiveSessionsForZone(sessions, zone.id, currentTime);
        const snapshot = calculateComplianceSnapshot(
            activeSessions.length,
            zone.totalLots,
            thresholds
        );

        return {
            zoneId: zone.id,
            zoneName: zone.name,
            ...snapshot
        };
    });
}

// ---- Geofence helpers ----
// These are thin aliases over geofencing-utils.js so callers
// have a single authoritative implementation. Requires
// geofencing-utils.js to be loaded first.
const haversineDistance = (a, b) =>
    (typeof calculateDistance === 'function') ? calculateDistance(a, b) : Infinity;

const isLocationInsideZone = (location, zone) =>
    (typeof isWithinGeofence === 'function') ? isWithinGeofence(location, zone) : false;

const findZoneContainingLocation = (location, zones) =>
    (typeof findZoneForCoords === 'function') ? findZoneForCoords(location, zones) : null;

/**
 * Validate compliance snapshot structure
 * @param {Object} snapshot - Snapshot object to validate
 * @returns {boolean} True if snapshot is valid
 */
function validateComplianceSnapshot(snapshot) {
    return (
        snapshot &&
        typeof snapshot === 'object' &&
        typeof snapshot.activeSessions === 'number' &&
        typeof snapshot.totalLots === 'number' &&
        typeof snapshot.complianceRate === 'number' &&
        ['green', 'orange', 'red'].includes(snapshot.statusColor) &&
        typeof snapshot.timestamp === 'number'
    );
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateComplianceRate,
        getComplianceStatusColor,
        getComplianceStatusLabel,
        calculateComplianceSnapshot,
        getActiveSessionsForZone,
        calculateComplianceForAllZones,
        validateComplianceSnapshot,
        haversineDistance,
        isLocationInsideZone,
        findZoneContainingLocation
    };
}
