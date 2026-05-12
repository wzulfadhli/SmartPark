// ============================================================
// data-generator.js — Continuous Parking Session Generator
// ============================================================
// This script runs continuously and generates new parking sessions
// while keeping historical data. It simulates real-world traffic
// where new cars park and old sessions expire naturally.
//
// Usage:
//   node data-generator.js
//
// Run alongside your app — it creates new active sessions every
// few minutes and marks expired ones as 'completed'.
// ============================================================

const admin = require('firebase-admin');
const path = require('path');

// ---- Shared modules ----
const SP_CONFIG = require(path.join(__dirname, '..', 'src', 'config'));
const SU = require(path.join(__dirname, '..', 'src', 'session-utils'));
const { findZoneForCoords } = require(path.join(__dirname, '..', 'src', 'geofencing-utils'));

// ---- Init ----
const useEmulator = process.env.FIRESTORE_EMULATOR_HOST;
if (useEmulator) {
    console.log('[Generator] Using Firestore emulator at', process.env.FIRESTORE_EMULATOR_HOST);
}

admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'your-project-id',
});

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

// ---- Config from centralized config.js ----
const SESSIONS_PER_BATCH = SP_CONFIG.GENERATOR.SESSIONS_PER_BATCH;
const MAX_TOTAL_SESSIONS = SP_CONFIG.GENERATOR.MAX_TOTAL_SESSIONS;
const OUTSIDE_PROB       = SP_CONFIG.GENERATOR.OUTSIDE_PROBABILITY;
const DUR_MIN            = SP_CONFIG.GENERATOR.DURATION_MIN_MINUTES;
const DUR_MAX            = SP_CONFIG.GENERATOR.DURATION_MAX_MINUTES;
const COLLECTIONS        = SP_CONFIG.COLLECTIONS;

// ---- Shorthand Timestamp helpers ----
function tsNow() { return Timestamp.fromMillis(Date.now()); }
function tsOffset(offsetMinutes) { return Timestamp.fromMillis(Date.now() + offsetMinutes * 60 * 1000); }

// ---- Zones cache ----
let ZONES = [];
async function loadZones() {
    const snap = await db.collection(COLLECTIONS.ZONES).get();
    ZONES = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`[Generator] Loaded ${ZONES.length} zones`);
}

// ---- 1. Generate new sessions ----
async function generateNewSessions() {
    if (ZONES.length === 0) await loadZones();

    // Only generate during operating hours
    if (!SU.isWithinOperatingHours()) {
        console.log(`[Generator] Outside operating hours (${new Date().toLocaleTimeString()}), skipping`);
        return;
    }

    // Check current count
    const allSnap = await db.collection(COLLECTIONS.PARKING_SESSIONS).get();
    if (allSnap.size >= MAX_TOTAL_SESSIONS) {
        console.log(`[Generator] Session limit reached (${allSnap.size}), skipping generation`);
        return;
    }

    const batch = db.batch();
    const created = [];

    for (let i = 0; i < SESSIONS_PER_BATCH; i++) {
        const zone = ZONES[Math.floor(SU.seededRandom() * ZONES.length)];
        const startOffset = Math.floor(SU.seededRandom() * 3) - 1;
        let duration = DUR_MIN + Math.floor(SU.seededRandom() * (DUR_MAX - DUR_MIN));
        let startMs = tsOffset(startOffset).toMillis();
        let endMs = startMs + duration * 60 * 1000;

        const clamped = SU.clampToOperatingHours(startMs, endMs);
        startMs = clamped.startMs;
        endMs = clamped.endMs;
        duration = Math.round((endMs - startMs) / 60000);

        const startTs = Timestamp.fromMillis(startMs);
        const endTs = Timestamp.fromMillis(endMs);
        const status = SU.computeStatus(startMs, endMs);

        const isOutside = SU.seededRandom() < OUTSIDE_PROB;
        const loc = isOutside ? SU.outsideLocationForZone(zone) : SU.locationForZone(zone);
        const zoneId = isOutside ? null : zone.id;
        const isCompliant = isOutside ? false : (status === 'active');
        const vehicleId = SU.randomVehicleId();

        const extRef = db.collection(COLLECTIONS.EXTERNAL_PAYMENT_SESSIONS).doc();
        batch.set(extRef, {
            vehicle_id: vehicleId,
            lat: loc.lat,
            lng: loc.lng,
            start_time: startTs,
            end_time: endTs,
            duration_minutes: duration,
            status: status,
            raw_payload: { source: 'auto-generator', zone_hint: isOutside ? null : zone.id },
            received_at: tsNow(),
            updated_at: tsNow(),
        });

        const psRef = db.collection(COLLECTIONS.PARKING_SESSIONS).doc();
        batch.set(psRef, {
            external_session_id: extRef.id,
            vehicle_id: vehicleId,
            lat: loc.lat,
            lng: loc.lng,
            zone_id: zoneId,
            is_compliant: isCompliant,
            start_time: startTs,
            end_time: endTs,
            duration_minutes: duration,
            status: status,
            synced_at: tsNow(),
            created_at: tsNow(),
        });

        created.push({ vehicle: vehicleId, zone: zone.name, duration });
    }

    await batch.commit();
    console.log(`[Generator] Created ${SESSIONS_PER_BATCH} new sessions:`,
        created.map(c => `${c.vehicle} in ${c.zone} (${c.duration}m)`).join(', '));
}

// ---- 2. Mark expired sessions as 'completed' ----
async function markExpiredSessions() {
    const now = Date.now();
    const expiredSnap = await db.collection(COLLECTIONS.PARKING_SESSIONS)
        .where('status', '==', 'active')
        .get();

    let updated = 0;
    const batch = db.batch();

    for (const doc of expiredSnap.docs) {
        const s = doc.data();
        const endMs = SU.toMillis(s.end_time);
        if (now > endMs) {
            batch.update(doc.ref, {
                status: 'completed',
                updated_at: tsNow(),
            });
            updated++;
        }
    }

    if (updated > 0) {
        await batch.commit();
        console.log(`[Generator] Marked ${updated} expired sessions as 'completed'`);
    } else {
        console.log('[Generator] No expired sessions to update');
    }
}

// ---- 3. Write compliance snapshot ----
async function writeComplianceSnapshot() {
    const now = Date.now();
    const activeSnap = await db.collection(COLLECTIONS.PARKING_SESSIONS)
        .where('status', '==', 'active')
        .get();

    const activeByZone = {};
    let outsideCount = 0;

    for (const doc of activeSnap.docs) {
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
        const color = rate >= CFG.COMPLIANCE_THRESHOLDS.HIGH ? 'green' : rate >= CFG.COMPLIANCE_THRESHOLDS.MEDIUM ? 'orange' : 'red';

        const ref = db.collection(COLLECTIONS.COMPLIANCE_SNAPSHOTS).doc();
        batch.set(ref, {
            zone_id: zone.id,
            zone_name: zone.name,
            timestamp: tsNow(),
            active_sessions: active,
            total_lots: zone.totalLots,
            compliance_rate: Math.round(rate * 10) / 10,
            status_color: color,
            outside_zone_count: outsideCount,
            created_at: tsNow(),
        });
    }

    await batch.commit();
    console.log('[Generator] Wrote compliance snapshot for', ZONES.length, 'zones');
}

// ---- Main loop ----
async function tick() {
    try {
        await generateNewSessions();
    } catch (err) {
        console.error('[Generator] New session generation failed:', err.message);
    }
}

async function expireTick() {
    try {
        await markExpiredSessions();
    } catch (err) {
        console.error('[Generator] Expiry check failed:', err.message);
    }
}

async function snapshotTick() {
    try {
        await writeComplianceSnapshot();
    } catch (err) {
        console.error('[Generator] Compliance snapshot failed:', err.message);
    }
}

// ---- 4. Populate missing sessions on startup ----
const ZONE_TARGETS = SP_CONFIG.ZONE_ACTIVE_TARGETS;

async function populateMissingSessions() {
    if (ZONES.length === 0) await loadZones();

    const now = Date.now();
    const activeSnap = await db.collection(COLLECTIONS.PARKING_SESSIONS)
        .where('status', '==', 'active')
        .get();

    const activeByZone = {};
    for (const doc of activeSnap.docs) {
        const s = doc.data();
        const endMs = SU.toMillis(s.end_time);
        if (now > endMs) continue;
        if (s.zone_id) {
            activeByZone[s.zone_id] = (activeByZone[s.zone_id] || 0) + 1;
        }
    }

    let totalCreated = 0;
    const batch = db.batch();
    const created = [];

    for (const zone of ZONES) {
        const target = ZONE_TARGETS[zone.id] || 0;
        const current = activeByZone[zone.id] || 0;
        const deficit = target - current;

        if (deficit <= 0) continue;

        console.log(`[Populate] Zone ${zone.name}: ${current}/${target} active, creating ${deficit} sessions`);

        for (let i = 0; i < deficit; i++) {
            const startOffset = -Math.floor(SU.seededRandom() * 30);
            let duration = DUR_MIN + Math.floor(SU.seededRandom() * (DUR_MAX - DUR_MIN));
            let startMs = tsOffset(startOffset).toMillis();
            let endMs = startMs + duration * 60 * 1000;

            const clamped = SU.clampToOperatingHours(startMs, endMs);
            startMs = clamped.startMs;
            endMs = clamped.endMs;
            duration = Math.round((endMs - startMs) / 60000);

            const startTs = Timestamp.fromMillis(startMs);
            const endTs = Timestamp.fromMillis(endMs);
            const status = SU.computeStatus(startMs, endMs);

            const isOutside = SU.seededRandom() < OUTSIDE_PROB;
            const loc = isOutside ? SU.outsideLocationForZone(zone) : SU.locationForZone(zone);
            const zoneId = isOutside ? null : zone.id;
            const isCompliant = isOutside ? false : (status === 'active');
            const vehicleId = SU.randomVehicleId();

            const extRef = db.collection(COLLECTIONS.EXTERNAL_PAYMENT_SESSIONS).doc();
            batch.set(extRef, {
                vehicle_id: vehicleId,
                lat: loc.lat,
                lng: loc.lng,
                start_time: startTs,
                end_time: endTs,
                duration_minutes: duration,
                status: status,
                raw_payload: { source: 'auto-generator', zone_hint: isOutside ? null : zone.id },
                received_at: tsNow(),
                updated_at: tsNow(),
            });

            const psRef = db.collection(COLLECTIONS.PARKING_SESSIONS).doc();
            batch.set(psRef, {
                external_session_id: extRef.id,
                vehicle_id: vehicleId,
                lat: loc.lat,
                lng: loc.lng,
                zone_id: zoneId,
                is_compliant: isCompliant,
                start_time: startTs,
                end_time: endTs,
                duration_minutes: duration,
                status: status,
                synced_at: tsNow(),
                created_at: tsNow(),
            });

            created.push({ zone: zone.name, duration });
            totalCreated++;

            // Firestore batch limit is 500
            if (totalCreated % 400 === 0) {
                await batch.commit();
                console.log(`[Populate] Committed ${totalCreated} sessions so far...`);
            }
        }
    }

    if (totalCreated > 0) {
        await batch.commit();
        console.log(`[Populate] Created ${totalCreated} sessions to reach targets`);
    } else {
        console.log('[Populate] All zones already at target active session counts');
    }
}

// ---- Main loop ----
async function main() {
    const startTime = Date.now();
    console.log('=== SmartPark Data Generator (Single Shot) ===');
    console.log('Project:', process.env.FIREBASE_PROJECT_ID || 'your-project-id');
    console.log('Run started:', new Date().toISOString(), '\n');

    await loadZones();

    // 1. Populate missing sessions to reach zone targets
    await populateMissingSessions();

    // 2. Mark expired sessions as completed
    await expireTick();

    // 3. Generate one new batch of sessions
    await tick();

    // 4. Write compliance snapshot
    await snapshotTick();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Single shot complete (${elapsed}s). Exiting...`);
}

main().catch(err => {
    console.error('\n❌ Generator failed:', err);
    process.exit(1);
});
