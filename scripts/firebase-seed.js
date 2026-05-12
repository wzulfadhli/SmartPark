// ============================================================
// firebase-seed.js — Demo Data Seeder
// ============================================================
// Run this once to populate your Firestore demo database.
// It seeds `zones`, `external_payment_sessions`, and the
// processed `parking_sessions` (simulating what Laravel would write).
//
// Usage:
//   node firebase-seed.js
//
// Prerequisites:
//   npm install firebase-admin
//   export GOOGLE_APPLICATION_CREDENTIALS="path/to/serviceAccountKey.json"
//   (or set FIREBASE_PROJECT_ID env var for emulator)
// ============================================================

const admin = require('firebase-admin');

// ---- Init ----
const useEmulator = process.env.FIRESTORE_EMULATOR_HOST;
if (useEmulator) {
    console.log('[Seed] Using Firestore emulator at', process.env.FIRESTORE_EMULATOR_HOST);
}

admin.initializeApp({
    // If GOOGLE_APPLICATION_CREDENTIALS is set, this is auto-detected.
    // For emulator: FIRESTORE_EMULATOR_HOST=localhost:8080
    projectId: process.env.FIREBASE_PROJECT_ID || 'your-project-id',
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

// ---- Helpers ----
// Use a live clock so status is computed correctly at seed time
const seedStartMs = Date.now();
function tsNow() { return Timestamp.fromMillis(Date.now()); }
function tsOffset(offsetMinutes) { return Timestamp.fromMillis(Date.now() + offsetMinutes * 60 * 1000); }

// ---- Operating hours helpers ----
// Parking operation: 8:00 AM - 6:00 PM
const OP_START_HOUR = 8;
const OP_END_HOUR = 18;

function getTodayAtHour(hour) {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
}

function clampToOperatingHours(startMs, endMs) {
    const opStart = getTodayAtHour(OP_START_HOUR);
    const opEnd = getTodayAtHour(OP_END_HOUR);
    if (startMs < opStart) startMs = opStart;
    if (endMs > opEnd) endMs = opEnd;
    if (startMs >= endMs) {
        endMs = startMs + 5 * 60 * 1000;
    }
    return { startMs, endMs };
}

// Compute real session status based on current time vs session window
function computeStatus(startMs, endMs) {
    const nowMs = Date.now();
    if (nowMs < startMs) return 'upcoming';
    if (nowMs > endMs) return 'completed';
    return 'active';
}

// Seeded pseudo-random (matches dummy-data.js so locations are identical)
let _seed = 12345;
function seededRandom() {
    _seed = (_seed * 16807 + 0) % 2147483647;
    return (_seed - 1) / 2147483646;
}

function randomVehicleId(n) { return `VEH_${String(n).padStart(3, '0')}`; }

// Generate a realistic GPS location within a zone
function locationForZone(zone) {
    if (zone.line && zone.line.length >= 2) {
        const buf = (zone.bufferMeters || 20) * 0.8;
        const segIdx = Math.floor(seededRandom() * (zone.line.length - 1));
        const p1 = zone.line[segIdx], p2 = zone.line[segIdx + 1];
        const t = seededRandom();
        const baseLat = p1.lat + t * (p2.lat - p1.lat);
        const baseLng = p1.lng + t * (p2.lng - p1.lng);
        const dLat = p2.lat - p1.lat, dLng = p2.lng - p1.lng;
        const len = Math.sqrt(dLat * dLat + dLng * dLng);
        const cosLat = Math.cos(baseLat * Math.PI / 180);
        const perpLat = (-dLng / len) * (buf / 111320);
        const perpLng = (dLat / len) * (buf / (111320 * cosLat));
        const side = (seededRandom() < 0.5 ? 1 : -1) * seededRandom();
        return { lat: baseLat + perpLat * side, lng: baseLng + perpLng * side };
    }
    const radius = zone.radius || 100;
    const angle = seededRandom() * 2 * Math.PI;
    const dist = Math.sqrt(seededRandom()) * radius * 0.8;
    const dLat = (dist * Math.cos(angle)) / 111320;
    const dLng = (dist * Math.sin(angle)) / (111320 * Math.cos(zone.center.lat * Math.PI / 180));
    return { lat: zone.center.lat + dLat, lng: zone.center.lng + dLng };
}

// PHP-equivalent geofence check (mirrors geofencing-utils.js)
function isWithinLineBoundingRect(coords, line, halfWidth = 20) {
    for (let i = 0; i < line.length - 1; i++) {
        const p1 = line[i], p2 = line[i + 1];
        const cosLat = Math.cos(((p1.lat + p2.lat) / 2) * Math.PI / 180);
        const bx = (p2.lng - p1.lng) * 111320 * cosLat;
        const by = (p2.lat - p1.lat) * 111320;
        const qx = (coords.lng - p1.lng) * 111320 * cosLat;
        const qy = (coords.lat - p1.lat) * 111320;
        const roadLen = Math.sqrt(bx * bx + by * by);
        if (roadLen === 0) continue;
        const ux = bx / roadLen, uy = by / roadLen;
        const along = qx * ux + qy * uy;
        const perp = Math.abs(-qx * uy + qy * ux);
        if (along >= 0 && along <= roadLen && perp <= halfWidth) return true;
    }
    return false;
}

function findZoneForCoords(coords, zones) {
    for (const zone of zones) {
        if (zone.line && zone.line.length >= 2) {
            if (isWithinLineBoundingRect(coords, zone.line, zone.bufferMeters || 20)) return zone;
        } else {
            const R = 6371e3;
            const φ1 = coords.lat * Math.PI / 180;
            const φ2 = zone.center.lat * Math.PI / 180;
            const Δφ = (zone.center.lat - coords.lat) * Math.PI / 180;
            const Δλ = (zone.center.lng - coords.lng) * Math.PI / 180;
            const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
            const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            if (dist <= zone.radius) return zone;
        }
    }
    return null;
}

// ============================================================
// ZONE DEFINITIONS (source of truth)
// ============================================================
const ZONES = [
    {
        id: 'zone_ss15_4',
        name: 'Jalan SS15/4',
        center: { lat: 3.0765, lng: 101.5890 },
        radius: 150,
        totalLots: 50,
        isActive: true,
    },
    {
        id: 'zone_ss15_8',
        name: 'Jalan SS15/8',
        center: { lat: 3.0750, lng: 101.5895 },
        radius: 120,
        totalLots: 40,
        isActive: true,
    },
    {
        id: 'zone_usj10_taipan',
        name: 'USJ 10 Taipan',
        center: { lat: 3.0485, lng: 101.5850 },
        radius: 200,
        totalLots: 120,
        isActive: true,
    },
    {
        id: 'zone_ss16_1',
        name: 'Jalan SS16/1',
        center: { lat: 3.0820, lng: 101.5865 },
        radius: 180,
        totalLots: 75,
        isActive: true,
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
            { lat: 3.0745650069976165, lng: 101.57970801776668 },
        ],
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
            { lat: 3.0786421942890456, lng: 101.58137902736576 },
        ],
    },
];

// ============================================================
// DEMO SESSIONS SPEC
// Mirrors dummy-data.js intentions:
//   zone_ss15_4     → 35 active  (70% of 50)   = Orange
//   zone_ss15_8     → 38 active  (95% of 40)   = Green
//   zone_usj10_taipan→ 45 active (37.5% of 120)= Red
//   zone_ss16_1     → 60 active  (80% of 75)   = Green
//   zone_ss17_1e    → 24 active  (60% of 40)   = Orange
//   zone_ss17_1b    → 5  active  (17% of 30)   = Red
// ============================================================
const SESSION_SPECS = [
    { zoneId: 'zone_ss15_4',       count: 35,  startRange: [-60, -5],  durationRange: [30, 120] },
    { zoneId: 'zone_ss15_8',       count: 38,  startRange: [-60, -5],  durationRange: [30, 120] },
    { zoneId: 'zone_usj10_taipan', count: 45,  startRange: [-60, -5],  durationRange: [30, 120] },
    { zoneId: 'zone_ss16_1',       count: 60,  startRange: [-60, -5],  durationRange: [30, 120] },
    { zoneId: 'zone_ss17_1e',      count: 24,  startRange: [-60, -5],  durationRange: [30, 120] },
    { zoneId: 'zone_ss17_1b',      count: 5,   startRange: [-60, -5],  durationRange: [30, 120] },
];

// Outside-zone sessions (payer exists, GPS is outside every zone)
const OUTSIDE_SPECS = [
    { vehicleId: 'VEH_OUT_001', lat: 3.07800, lng: 101.59050, start: -25, duration: 60 },
    { vehicleId: 'VEH_OUT_002', lat: 3.07300, lng: 101.58800, start: -10, duration: 45 },
    { vehicleId: 'VEH_OUT_003', lat: 3.04600, lng: 101.57800, start: -40, duration: 90 },
    { vehicleId: 'VEH_OUT_004', lat: 3.08400, lng: 101.58200, start: -15, duration: 30 },
    { vehicleId: 'VEH_OUT_005', lat: 3.07500, lng: 101.59200, start: -50, duration: 120 },
];

// ============================================================
// SEED FUNCTIONS
// ============================================================

async function seedZones() {
    console.log('\n[Zones] Seeding', ZONES.length, 'zones...');
    const batch = db.batch();
    for (const zone of ZONES) {
        const { id, ...data } = zone;
        const ref = db.collection('zones').doc(id);
        batch.set(ref, {
            ...data,
            createdAt: tsNow(),
            updatedAt: tsNow(),
        });
    }
    await batch.commit();
    console.log('[Zones] ✓ Done');
}

async function seedExternalSessions() {
    console.log('\n[ExternalSessions] Seeding external_payment_sessions...');
    let count = 0;

    for (const spec of SESSION_SPECS) {
        const zone = ZONES.find(z => z.id === spec.zoneId);
        for (let i = 0; i < spec.count; i++) {
            const startOffset = spec.startRange[0] + seededRandom() * (spec.startRange[1] - spec.startRange[0]);
            let duration = spec.durationRange[0] + Math.round(seededRandom() * (spec.durationRange[1] - spec.durationRange[0]));
            const location = locationForZone(zone);
            const extId = `ext_${zone.id}_${count + 1}`;

            let startMs = tsOffset(startOffset).toMillis();
            let endMs = startMs + duration * 60 * 1000;
            const clamped = clampToOperatingHours(startMs, endMs);
            startMs = clamped.startMs;
            endMs = clamped.endMs;
            duration = Math.round((endMs - startMs) / 60000);

            const startTs = Timestamp.fromMillis(startMs);
            const endTs   = Timestamp.fromMillis(endMs);
            const realStatus = computeStatus(startMs, endMs);
            await db.collection('external_payment_sessions').doc(extId).set({
                vehicle_id:       randomVehicleId(count + 1),
                lat:              location.lat,
                lng:              location.lng,
                start_time:       startTs,
                end_time:         endTs,
                duration_minutes: duration,
                status:           realStatus,
                raw_payload:      { source: 'demo-seed', zone_hint: zone.id },
                received_at:      tsNow(),
                updated_at:       tsNow(),
            });
            count++;
        }
    }

    // Outside-zone sessions
    for (const o of OUTSIDE_SPECS) {
        const extId = `ext_outside_${o.vehicleId}`;
        let outStartMs = tsOffset(o.start).toMillis();
        let outEndMs = outStartMs + o.duration * 60 * 1000;
        const outClamped = clampToOperatingHours(outStartMs, outEndMs);
        outStartMs = outClamped.startMs;
        outEndMs = outClamped.endMs;
        const outDuration = Math.round((outEndMs - outStartMs) / 60000);
        const outStartTs = Timestamp.fromMillis(outStartMs);
        const outEndTs   = Timestamp.fromMillis(outEndMs);
        const outRealStatus = computeStatus(outStartMs, outEndMs);
        await db.collection('external_payment_sessions').doc(extId).set({
            vehicle_id:       o.vehicleId,
            lat:              o.lat,
            lng:              o.lng,
            start_time:       outStartTs,
            end_time:         outEndTs,
            duration_minutes: outDuration,
            status:           outRealStatus,
            raw_payload:      { source: 'demo-seed', zone_hint: null },
            received_at:      tsNow(),
            updated_at:       tsNow(),
        });
        count++;
    }

    console.log('[ExternalSessions] ✓ Seeded', count, 'records');
    return count;
}

async function seedParkingSessions() {
    console.log('\n[ParkingSessions] Running geofence resolution & seeding parking_sessions...');

    // Fetch external sessions (simulates what Laravel scheduler reads)
    const extSnap = await db.collection('external_payment_sessions').get();
    let created = 0, outside = 0;
    const batch = db.batch();

    for (const doc of extSnap.docs) {
        const ext = doc.data();
        const coords = { lat: ext.lat, lng: ext.lng };

        // PHP geofence check (same algorithm as geofencing-utils.js)
        const matchedZone = findZoneForCoords(coords, ZONES);
        const zoneId = matchedZone ? matchedZone.id : null;

        const startMs = ext.start_time.toMillis();
        const endMs = ext.end_time.toMillis();
        const currentNow = Date.now();
        const isWithinWindow = currentNow >= startMs && currentNow <= endMs;
        const realStatus = computeStatus(startMs, endMs);
        const isCompliant = zoneId !== null && realStatus === 'active' && isWithinWindow;

        const ref = db.collection('parking_sessions').doc();
        batch.set(ref, {
            external_session_id: doc.id,
            vehicle_id:          ext.vehicle_id,
            lat:                 ext.lat,
            lng:                 ext.lng,
            zone_id:             zoneId,
            is_compliant:        isCompliant,
            start_time:          ext.start_time,
            end_time:            ext.end_time,
            duration_minutes:    ext.duration_minutes,
            status:              realStatus,
            synced_at:           tsNow(),
            created_at:          tsNow(),
        });

        if (zoneId) created++; else outside++;
    }

    await batch.commit();
    console.log(`[ParkingSessions] ✓ Written ${created + outside} records (${created} in-zone, ${outside} outside)`);
}

async function seedComplianceSnapshot() {
    console.log('\n[ComplianceSnapshot] Writing initial snapshot...');

    // Read parking_sessions to build snapshot
    const sessionsSnap = await db.collection('parking_sessions')
        .where('status', '==', 'active')
        .get();

    const activeByZone = {};
    let outsideCount = 0;

    for (const doc of sessionsSnap.docs) {
        const s = doc.data();
        const startMs = s.start_time.toMillis();
        const endMs = s.end_time.toMillis();
        if (now < startMs || now > endMs) continue; // time-window check

        if (s.zone_id) {
            activeByZone[s.zone_id] = (activeByZone[s.zone_id] || 0) + 1;
        } else {
            outsideCount++;
        }
    }

    const batch = db.batch();
    for (const zone of ZONES) {
        const active = activeByZone[zone.id] || 0;
        const rate = Math.min(100, (active / zone.totalLots) * 100);
        const color = rate >= 80 ? 'green' : rate >= 50 ? 'orange' : 'red';

        const ref = db.collection('compliance_snapshots').doc();
        batch.set(ref, {
            zone_id:             zone.id,
            zone_name:           zone.name,
            timestamp:           tsNow(),
            active_sessions:     active,
            total_lots:          zone.totalLots,
            compliance_rate:     Math.round(rate * 10) / 10,
            status_color:        color,
            outside_zone_count:  outsideCount,
            created_at:          tsNow(),
        });
    }

    await batch.commit();
    console.log('[ComplianceSnapshot] ✓ Done');
}

async function seedSyncRun() {
    console.log('\n[SyncRun] Writing seed sync_run record...');
    await db.collection('sync_runs').add({
        started_at:       tsOffset(-1),
        completed_at:     tsNow(),
        duration_ms:      850,
        sessions_polled:  SESSION_SPECS.reduce((s, sp) => s + sp.count, 0) + OUTSIDE_SPECS.length,
        sessions_created: SESSION_SPECS.reduce((s, sp) => s + sp.count, 0) + OUTSIDE_SPECS.length,
        sessions_updated: 0,
        sessions_skipped: 0,
        error_count:      0,
        errors:           [],
        trigger:          'seed',
    });
    console.log('[SyncRun] ✓ Done');
}

// ============================================================
// CLEAR EXISTING DEMO DATA (optional, run before re-seeding)
// ============================================================
async function clearCollection(name) {
    const snap = await db.collection(name).get();
    if (snap.empty) return;
    const CHUNK = 400; // Firestore batch limit is 500
    for (let i = 0; i < snap.docs.length; i += CHUNK) {
        const batch = db.batch();
        snap.docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
        await batch.commit();
    }
    console.log(`[Clear] Deleted ${snap.docs.length} docs from '${name}'`);
}

async function clearAll() {
    console.log('\n[Clear] Clearing existing demo data...');
    await Promise.all([
        clearCollection('zones'),
        clearCollection('external_payment_sessions'),
        clearCollection('parking_sessions'),
        clearCollection('compliance_snapshots'),
        clearCollection('sync_runs'),
    ]);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    const args = process.argv.slice(2);
    const shouldClear = args.includes('--clear') || args.includes('--reset');

    console.log('=== SmartPark Firebase Seed ===');
    console.log('Project:', process.env.FIREBASE_PROJECT_ID || 'your-project-id');
    console.log('Emulator:', useEmulator ? process.env.FIRESTORE_EMULATOR_HOST : 'No');

    if (shouldClear) {
        await clearAll();
    }

    await seedZones();
    await seedExternalSessions();
    await seedParkingSessions();
    await seedComplianceSnapshot();
    await seedSyncRun();

    console.log('\n✅ Seed complete. Collections written:');
    console.log('   • zones');
    console.log('   • external_payment_sessions');
    console.log('   • parking_sessions');
    console.log('   • compliance_snapshots');
    console.log('   • sync_runs');
    console.log('\nRun with --clear to wipe and re-seed: node firebase-seed.js --clear');
}

main().catch(err => {
    console.error('\n❌ Seed failed:', err);
    process.exit(1);
});
