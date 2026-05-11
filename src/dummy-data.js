// ============================================================
// DUMMY DATA FOR GPS/GEOFENCING PARKING SYSTEM
// ============================================================
// This file contains realistic dummy data for testing the
// geofencing and compliance logic. Replace with real data
// from Firebase in production.
// ============================================================

// Current time for demo purposes (set to a specific time for consistent testing)
// In production, this would be Date.now()
const DEMO_CURRENT_TIME = Date.now();

// Seeded pseudo-random generator so dummy data is deterministic across page loads.
// (Each page loads this file independently; without a seed, Math.random() produces
// different locations per page, making zone counts differ.)
let _seed = 12345;
function seededRandom() {
    _seed = (_seed * 16807 + 0) % 2147483647;
    return (_seed - 1) / 2147483646;
}

// ============================================================
// GEOFENCED ZONES
// ============================================================
// Based on original sensor locations in Subang Jaya, Malaysia
// ============================================================

const DUMMY_ZONES = [
    {
        id: 'zone_ss15_4',
        name: 'Jalan SS15/4',
        center: { lat: 3.0765, lng: 101.5890 },
        radius: 150, // meters
        totalLots: 50,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'zone_ss15_8',
        name: 'Jalan SS15/8',
        center: { lat: 3.0750, lng: 101.5895 },
        radius: 120,
        totalLots: 40,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'zone_usj10_taipan',
        name: 'USJ 10 Taipan',
        center: { lat: 3.0485, lng: 101.5850 },
        radius: 200,
        totalLots: 120,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'zone_ss16_1',
        name: 'Jalan SS16/1',
        center: { lat: 3.0820, lng: 101.5865 },
        radius: 180,
        totalLots: 75,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'zone_ss17_1e',
        name: 'Jalan SS17/1E',
        center: { lat: 3.07597, lng: 101.58010 },
        radius: 200,
        bufferMeters: 35,
        totalLots: 40,
        isActive: true,
        line: [
            { lat: 3.077359121599855,  lng: 101.58049118471104 },
            { lat: 3.0770779840562454, lng: 101.58043347219171 },
            { lat: 3.077049169401164,  lng: 101.58042957269771 },
            { lat: 3.076699191195715,  lng: 101.58032093230793 },
            { lat: 3.0764660411565927, lng: 101.5802499517277  },
            { lat: 3.0761054317447503, lng: 101.58015388301482 },
            { lat: 3.075641876459102,  lng: 101.58001257976917 },
            { lat: 3.0745650069976165, lng: 101.57970801776668 }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'zone_ss17_1b',
        name: 'Jalan SS17/1B',
        center: { lat: 3.07856, lng: 101.58066 },
        radius: 70,
        bufferMeters: 35,
        totalLots: 30,
        isActive: true,
        line: [
            { lat: 3.0784821661062836, lng: 101.57993950376465 },
            { lat: 3.0786421942890456, lng: 101.58137902736576 }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }
];

// ============================================================
// PAYMENT SESSIONS
// ============================================================
// 30 dummy sessions with varying states:
// - Active sessions (current time is within start-end range)
// - Expired sessions (end time is in the past)
// - Future sessions (start time is in the future)
// ============================================================

const DUMMY_PAYMENT_SESSIONS = [];

// Helper to create a session (snake_case to match Firestore schema)
function createSession(zoneId, vehicleId, startOffsetMinutes, durationMinutes) {
    const startTime = DEMO_CURRENT_TIME + (startOffsetMinutes * 60 * 1000);
    const endTime = startTime + (durationMinutes * 60 * 1000);
    const zone = DUMMY_ZONES.find(z => z.id === zoneId);

    // Generate a realistic GPS location within the zone's geofence
    let lat, lng;
    if (zone && zone.line && zone.line.length >= 2) {
        // Line-type zone: pick a random segment, then a random point along it,
        // offset by up to bufferMeters perpendicular (so it stays inside the rectangle)
        const buf = (zone.bufferMeters || 20) * 0.8;
        const segIdx = Math.floor(seededRandom() * (zone.line.length - 1));
        const p1 = zone.line[segIdx], p2 = zone.line[segIdx + 1];
        const t = seededRandom(); // position along segment [0,1]
        const baseLat = p1.lat + t * (p2.lat - p1.lat);
        const baseLng = p1.lng + t * (p2.lng - p1.lng);
        // Perpendicular offset direction
        const dLat = p2.lat - p1.lat, dLng = p2.lng - p1.lng;
        const len = Math.sqrt(dLat * dLat + dLng * dLng);
        const cosLat = Math.cos(baseLat * Math.PI / 180);
        const perpLat = (-dLng / len) * (buf / 111320);
        const perpLng = (dLat / len) * (buf / (111320 * cosLat));
        const side = (seededRandom() < 0.5 ? 1 : -1) * seededRandom();
        lat = baseLat + perpLat * side;
        lng = baseLng + perpLng * side;
    } else if (zone && zone.center) {
        const radius = zone.radius || 100;
        const angle = seededRandom() * 2 * Math.PI;
        const dist = Math.sqrt(seededRandom()) * radius * 0.8; // keep within 80% of radius
        const dLat = (dist * Math.cos(angle)) / 111320;
        const dLng = (dist * Math.sin(angle)) / (111320 * Math.cos(zone.center.lat * Math.PI / 180));
        lat = zone.center.lat + dLat;
        lng = zone.center.lng + dLng;
    } else {
        lat = 0;
        lng = 0;
    }

    // Determine status based on current time relative to session window
    const now = Date.now();
    let status;
    if (now < startTime) {
        status = 'upcoming';
    } else if (now > endTime) {
        status = 'completed';
    } else {
        status = 'active';
    }

    return {
        id: `session_${seededRandom().toString(36).substr(2, 9)}`,
        zone_id: zoneId,
        vehicle_id: vehicleId,
        lat: lat,
        lng: lng,
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
// ACTIVE SESSIONS (currently within time range)
// ============================================================

// Zone 1: Jalan SS15/4 (50 lots) - 35 active sessions = 70% compliance = Orange
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_001', -30, 60));  // Started 30 min ago, 30 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_002', -45, 90));  // Started 45 min ago, 45 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_003', -15, 30));  // Started 15 min ago, 15 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_004', -60, 120)); // Started 60 min ago, 60 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_005', -20, 45));  // Started 20 min ago, 25 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_006', -10, 30));  // Started 10 min ago, 20 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_007', -50, 90));  // Started 50 min ago, 40 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_008', -25, 60));  // Started 25 min ago, 35 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_009', -5, 30));   // Started 5 min ago, 25 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_010', -40, 75));  // Started 40 min ago, 35 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_011', -35, 70));  // Started 35 min ago, 35 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_012', -55, 100)); // Started 55 min ago, 45 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_013', -12, 40));  // Started 12 min ago, 28 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_014', -28, 55));  // Started 28 min ago, 27 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_015', -18, 35));  // Started 18 min ago, 17 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_016', -42, 80));  // Started 42 min ago, 38 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_017', -8, 25));   // Started 8 min ago, 17 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_018', -33, 65));  // Started 33 min ago, 32 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_019', -22, 50));  // Started 22 min ago, 28 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_020', -48, 95));  // Started 48 min ago, 47 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_021', -16, 40));  // Started 16 min ago, 24 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_022', -38, 75));  // Started 38 min ago, 37 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_023', -26, 55));  // Started 26 min ago, 29 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_024', -14, 35));  // Started 14 min ago, 21 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_025', -52, 105)); // Started 52 min ago, 53 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_026', -29, 60));  // Started 29 min ago, 31 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_027', -11, 30));  // Started 11 min ago, 19 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_028', -44, 85));  // Started 44 min ago, 41 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_029', -19, 45));  // Started 19 min ago, 26 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_030', -31, 70));  // Started 31 min ago, 39 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_031', -7, 25));   // Started 7 min ago, 18 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_032', -37, 75));  // Started 37 min ago, 38 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_033', -23, 50));  // Started 23 min ago, 27 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_034', -13, 35));  // Started 13 min ago, 22 min remaining
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_4', 'VEH_035', -46, 90));  // Started 46 min ago, 44 min remaining

// Zone 2: Jalan SS15/8 (40 lots) - 38 active sessions = 95% compliance = Green
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_036', -25, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_037', -40, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_038', -15, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_039', -55, 120));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_040', -20, 45));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_041', -10, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_042', -50, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_043', -30, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_044', -5, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_045', -45, 75));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_046', -35, 70));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_047', -60, 100));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_048', -12, 40));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_049', -28, 55));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_050', -18, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_051', -42, 80));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_052', -8, 25));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_053', -33, 65));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_054', -22, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_055', -48, 95));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_056', -16, 40));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_057', -38, 75));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_058', -26, 55));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_059', -14, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_060', -52, 105));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_061', -29, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_062', -11, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_063', -44, 85));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_064', -19, 45));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_065', -31, 70));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_066', -7, 25));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_067', -37, 75));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_068', -23, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_069', -13, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_070', -46, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_071', -21, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss15_8', 'VEH_072', -34, 70));

// Zone 3: USJ 10 Taipan (120 lots) - 45 active sessions = 37.5% compliance = Red
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_073', -30, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_074', -45, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_075', -15, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_076', -60, 120));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_077', -20, 45));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_078', -10, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_079', -50, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_080', -30, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_081', -5, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_082', -45, 75));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_083', -35, 70));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_084', -60, 100));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_085', -12, 40));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_086', -28, 55));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_087', -18, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_088', -42, 80));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_089', -8, 25));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_090', -33, 65));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_091', -22, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_092', -48, 95));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_093', -16, 40));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_094', -38, 75));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_095', -26, 55));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_096', -14, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_097', -52, 105));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_098', -29, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_099', -11, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_100', -44, 85));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_101', -19, 45));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_102', -31, 70));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_103', -7, 25));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_104', -37, 75));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_105', -23, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_106', -13, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_107', -46, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_108', -21, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_109', -34, 70));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_110', -27, 55));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_111', -17, 40));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_112', -39, 80));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_113', -9, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_114', -32, 65));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_115', -24, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_116', -15, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_usj10_taipan', 'VEH_117', -47, 95));

// Zone 4: Jalan SS16/1 (75 lots) - 60 active sessions = 80% compliance = Green
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_118', -30, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_119', -45, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_120', -15, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_121', -60, 120));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_122', -20, 45));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_123', -10, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_124', -50, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_125', -30, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_126', -5, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_127', -45, 75));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_128', -35, 70));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_129', -60, 100));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_130', -12, 40));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_131', -28, 55));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_132', -18, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_133', -42, 80));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_134', -8, 25));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_135', -33, 65));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_136', -22, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_137', -48, 95));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_138', -16, 40));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_139', -38, 75));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_140', -26, 55));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_141', -14, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_142', -52, 105));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_143', -29, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_144', -11, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_145', -44, 85));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_146', -19, 45));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_147', -31, 70));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_148', -7, 25));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_149', -37, 75));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_150', -23, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_151', -13, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_152', -46, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_153', -21, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_154', -34, 70));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_155', -27, 55));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_156', -17, 40));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_157', -39, 80));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_158', -9, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_159', -32, 65));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_160', -24, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_161', -15, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_162', -47, 95));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_163', -36, 75));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_164', -28, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_165', -41, 85));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_166', -19, 45));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_167', -33, 70));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_168', -12, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_169', -25, 55));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_170', -43, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_171', -16, 40));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_172', -38, 80));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_173', -22, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_174', -30, 65));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_175', -14, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_176', -49, 100));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss16_1', 'VEH_177', -26, 55));

// Jalan SS17/1E active sessions
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_201', -12, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_202', -28, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_203', -8,  45));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_204', -35, 120));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_205', -20, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_206', -50, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_207', -38, 80));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_208', -22, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_209', -30, 65));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_210', -14, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_211', -49, 100));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_212', -26, 55));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_213', -13, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_214', -46, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_215', -21, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_216', -34, 70));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_217', -27, 55));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_218', -17, 40));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_219', -39, 80));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_220', -9, 30));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_221', -32, 65));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_222', -24, 50));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_223', -15, 35));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1e', 'VEH_224', -47, 95));

// Jalan SS17/1B active sessions
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1b', 'VEH_191', -10, 60));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1b', 'VEH_192', -25, 90));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1b', 'VEH_193', -5, 45));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1b', 'VEH_194', -40, 120));
DUMMY_PAYMENT_SESSIONS.push(createSession('zone_ss17_1b', 'VEH_195', -18, 60));

// ============================================================
// OUTSIDE-ZONE SESSIONS (paid, but GPS location is NOT inside any geofenced zone)
// ============================================================
// These payers have an active payment session but their parked
// location falls outside every defined zone. They are NOT counted
// in any zone's compliance because zoneId is null.
// ============================================================

function createOutsideSession(vehicleId, lat, lng, startOffsetMinutes, durationMinutes) {
    const startTime = DEMO_CURRENT_TIME + (startOffsetMinutes * 60 * 1000);
    const endTime = startTime + (durationMinutes * 60 * 1000);
    return {
        id: `session_${seededRandom().toString(36).substr(2, 9)}`,
        vehicle_id: vehicleId,
        lat: lat,
        lng: lng,
        zone_id: null,
        start_time: startTime,
        end_time: endTime,
        duration_minutes: durationMinutes,
        status: 'active',
        is_compliant: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
}

// Place each outside-zone payer 10–100 m beyond a zone's radius edge,
// so they appear near a zone but clearly outside its geofence.
function offsetFromZone(zone, metersBeyondRadius, bearingDeg) {
    const totalMeters = (zone.radius || 100) + metersBeyondRadius;
    const rad = (bearingDeg * Math.PI) / 180;
    const dLat = (totalMeters * Math.cos(rad)) / 111320;
    const dLng = (totalMeters * Math.sin(rad)) / (111320 * Math.cos(zone.center.lat * Math.PI / 180));
    return { lat: zone.center.lat + dLat, lng: zone.center.lng + dLng };
}

// One outside-zone payer near each zone (varying bearings for visual spread)
[
    { zoneId: 'zone_ss15_4',       beyond: 25,  bearing: 45,  vehicle: 'VEH_OUT_001', startOffset: -25, duration: 60 },
    { zoneId: 'zone_ss15_8',       beyond: 60,  bearing: 135, vehicle: 'VEH_OUT_002', startOffset: -10, duration: 45 },
    { zoneId: 'zone_usj10_taipan', beyond: 80,  bearing: 220, vehicle: 'VEH_OUT_003', startOffset: -40, duration: 90 },
    { zoneId: 'zone_ss16_1',       beyond: 40,  bearing: 310, vehicle: 'VEH_OUT_004', startOffset: -15, duration: 30 },
    { zoneId: 'zone_ss15_4',       beyond: 95,  bearing: 180, vehicle: 'VEH_OUT_005', startOffset: -50, duration: 120 },
].forEach(o => {
    const zone = DUMMY_ZONES.find(z => z.id === o.zoneId);
    if (!zone) return;
    const { lat, lng } = offsetFromZone(zone, o.beyond, o.bearing);
    DUMMY_PAYMENT_SESSIONS.push(createOutsideSession(o.vehicle, lat, lng, o.startOffset, o.duration));
});


// ============================================================
// EXPIRED SESSIONS (end time is in the past)
// ============================================================

for (let i = 178; i <= 185; i++) {
    const session = createSession('zone_ss15_4', `VEH_${i}`, -120, 60);
    session.status = 'completed';
    // Keep endTime consistent with the declared duration
    session.endTime = session.startTime + (session.durationMinutes * 60 * 1000);
    DUMMY_PAYMENT_SESSIONS.push(session);
}

// ============================================================
// FUTURE SESSIONS (start time is in the future)
// ============================================================

for (let i = 186; i <= 190; i++) {
    const session = createSession('zone_ss15_8', `VEH_${i}`, 30, 60);
    session.status = 'upcoming';
    DUMMY_PAYMENT_SESSIONS.push(session);
}

// ============================================================
// MANUAL TEST SESSIONS
// ============================================================
// Use createManualSession() to inject a session at exact GPS
// coordinates. Useful for testing geofence edge cases.
//
// createManualSession(vehicle_id, lat, lng, startOffsetMinutes, durationMinutes)
//   vehicle_id         – any string, e.g. 'MY_CAR'
//   lat / lng          – exact GPS coordinates
//   startOffsetMinutes – minutes relative to now (negative = already started)
//   durationMinutes    – how long the session lasts
//
// Examples:
//   DUMMY_PAYMENT_SESSIONS.push(createManualSession('MY_CAR', 3.07650, 101.58020, -10, 60));
//   DUMMY_PAYMENT_SESSIONS.push(createManualSession('TEST_OUTSIDE', 3.07200, 101.57500, -5, 30));
// ============================================================

function createManualSession(vehicleId, lat, lng, startOffsetMinutes, durationMinutes) {
    const startTime = DEMO_CURRENT_TIME + (startOffsetMinutes * 60 * 1000);
    const endTime   = startTime + (durationMinutes * 60 * 1000);
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


if (typeof window !== 'undefined') {
    window.DUMMY_ZONES = DUMMY_ZONES;
    window.DUMMY_PAYMENT_SESSIONS = DUMMY_PAYMENT_SESSIONS;
    window.DEMO_CURRENT_TIME = DEMO_CURRENT_TIME;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DUMMY_ZONES,
        DUMMY_PAYMENT_SESSIONS,
        DEMO_CURRENT_TIME
    };
}
