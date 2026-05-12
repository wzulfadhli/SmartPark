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
const path = require('path');

// ---- Shared modules ----
const SP_CONFIG = require(path.join(__dirname, '..', 'src', 'config'));
const SU = require(path.join(__dirname, '..', 'src', 'session-utils'));
const { ZONE_DEFINITIONS: ZONES, OUTSIDE_ZONE_SPECS: OUTSIDE_SPECS } = require(path.join(__dirname, '..', 'src', 'zones-config'));
const { findZoneForCoords } = require(path.join(__dirname, '..', 'src', 'geofencing-utils'));

// ---- Init ----
const useEmulator = process.env.FIRESTORE_EMULATOR_HOST;
if (useEmulator) {
    console.log('[Seed] Using Firestore emulator at', process.env.FIRESTORE_EMULATOR_HOST);
}

admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'your-project-id',
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

// ---- Config from centralized config.js ----
const COLLECTIONS = SP_CONFIG.COLLECTIONS;
const ZONE_TARGETS = SP_CONFIG.ZONE_ACTIVE_TARGETS;
const DUR_MIN = SP_CONFIG.GENERATOR.DURATION_MIN_MINUTES;
const DUR_MAX = SP_CONFIG.GENERATOR.DURATION_MAX_MINUTES;

// ---- Timestamp helpers ----
function tsNow() { return Timestamp.fromMillis(Date.now()); }
function tsOffset(offsetMinutes) { return Timestamp.fromMillis(Date.now() + offsetMinutes * 60 * 1000); }

// ---- Build SESSION_SPECS from config targets ----
const SESSION_SPECS = Object.entries(ZONE_TARGETS).map(([zoneId, count]) => ({
    zoneId, count, startRange: [-60, -5], durationRange: [DUR_MIN, DUR_MAX],
}));

// ============================================================
// SEED FUNCTIONS
// ============================================================

async function seedZones() {
    console.log('\n[Zones] Seeding', ZONES.length, 'zones...');
    const batch = db.batch();
    for (const zone of ZONES) {
        const { id, ...data } = zone;
        const ref = db.collection(COLLECTIONS.ZONES).doc(id);
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
            const startOffset = spec.startRange[0] + SU.seededRandom() * (spec.startRange[1] - spec.startRange[0]);
            let duration = spec.durationRange[0] + Math.round(SU.seededRandom() * (spec.durationRange[1] - spec.durationRange[0]));
            const location = SU.locationForZone(zone);
            const extId = `ext_${zone.id}_${count + 1}`;

            let startMs = tsOffset(startOffset).toMillis();
            let endMs = startMs + duration * 60 * 1000;
            const clamped = SU.clampToOperatingHours(startMs, endMs);
            startMs = clamped.startMs;
            endMs = clamped.endMs;
            duration = Math.round((endMs - startMs) / 60000);

            const startTs = Timestamp.fromMillis(startMs);
            const endTs   = Timestamp.fromMillis(endMs);
            const realStatus = SU.computeStatus(startMs, endMs);
            await db.collection(COLLECTIONS.EXTERNAL_PAYMENT_SESSIONS).doc(extId).set({
                vehicle_id:       SU.randomVehicleId(count + 1),
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
        const outClamped = SU.clampToOperatingHours(outStartMs, outEndMs);
        outStartMs = outClamped.startMs;
        outEndMs = outClamped.endMs;
        const outDuration = Math.round((outEndMs - outStartMs) / 60000);
        const outStartTs = Timestamp.fromMillis(outStartMs);
        const outEndTs   = Timestamp.fromMillis(outEndMs);
        const outRealStatus = SU.computeStatus(outStartMs, outEndMs);
        await db.collection(COLLECTIONS.EXTERNAL_PAYMENT_SESSIONS).doc(extId).set({
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
    const extSnap = await db.collection(COLLECTIONS.EXTERNAL_PAYMENT_SESSIONS).get();
    let created = 0, outside = 0;
    const batch = db.batch();

    for (const doc of extSnap.docs) {
        const ext = doc.data();
        const coords = { lat: ext.lat, lng: ext.lng };

        // PHP geofence check (same algorithm as geofencing-utils.js)
        const matchedZone = findZoneForCoords(coords, ZONES);
        const zoneId = matchedZone ? matchedZone.id : null;

        const startMs = SU.toMillis(ext.start_time);
        const endMs = SU.toMillis(ext.end_time);
        const currentNow = Date.now();
        const isWithinWindow = currentNow >= startMs && currentNow <= endMs;
        const realStatus = SU.computeStatus(startMs, endMs);
        const isCompliant = zoneId !== null && realStatus === 'active' && isWithinWindow;

        const ref = db.collection(COLLECTIONS.PARKING_SESSIONS).doc();
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

    const now = Date.now();
    // Read parking_sessions to build snapshot
    const sessionsSnap = await db.collection(COLLECTIONS.PARKING_SESSIONS)
        .where('status', '==', 'active')
        .get();

    const activeByZone = {};
    let outsideCount = 0;

    for (const doc of sessionsSnap.docs) {
        const s = doc.data();
        const startMs = SU.toMillis(s.start_time);
        const endMs = SU.toMillis(s.end_time);
        if (now < startMs || now > endMs) continue;

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
        const color = rate >= SP_CONFIG.COMPLIANCE_THRESHOLDS.HIGH ? 'green' : rate >= SP_CONFIG.COMPLIANCE_THRESHOLDS.MEDIUM ? 'orange' : 'red';

        const ref = db.collection(COLLECTIONS.COMPLIANCE_SNAPSHOTS).doc();
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
    await db.collection(COLLECTIONS.SYNC_RUNS).add({
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
    await Promise.all(
        Object.values(COLLECTIONS).map(name => clearCollection(name))
    );
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
