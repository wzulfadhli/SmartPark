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

// ---- Config ----
const GENERATE_INTERVAL_MS = 2 * 60 * 1000;   // New batch every 2 minutes
const EXPIRE_CHECK_MS     = 5 * 60 * 1000;    // Mark expired sessions every 5 minutes
const COMPLIANCE_SNAPSHOT_MS = 5 * 60 * 1000; // Write compliance snapshot every 5 minutes
const SESSIONS_PER_BATCH = 5;                  // New sessions per batch
const MAX_TOTAL_SESSIONS = 300;               // Keep total under this (soft limit)

// Seeded pseudo-random
let _seed = Date.now() % 2147483647;
function seededRandom() {
    _seed = (_seed * 16807 + 0) % 2147483647;
    return (_seed - 1) / 2147483646;
}

function randomVehicleId() {
    const num = Math.floor(seededRandom() * 900) + 100;
    return `VEH_${num}`;
}

function tsNow() { return Timestamp.fromMillis(Date.now()); }
function tsOffset(offsetMinutes) { return Timestamp.fromMillis(Date.now() + offsetMinutes * 60 * 1000); }

function computeStatus(startMs, endMs) {
    const nowMs = Date.now();
    if (nowMs < startMs) return 'upcoming';
    if (nowMs > endMs) return 'completed';
    return 'active';
}

// ---- Zones cache ----
let ZONES = [];
async function loadZones() {
    const snap = await db.collection('zones').get();
    ZONES = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`[Generator] Loaded ${ZONES.length} zones`);
}

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

function findZoneForCoords(coords, zones) {
    for (const zone of zones) {
        if (zone.line && zone.line.length >= 2) {
            for (let i = 0; i < zone.line.length - 1; i++) {
                const p1 = zone.line[i], p2 = zone.line[i + 1];
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
                if (along >= 0 && along <= roadLen && perp <= (zone.bufferMeters || 20)) return zone;
            }
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

// ---- 1. Generate new sessions ----
async function generateNewSessions() {
    if (ZONES.length === 0) await loadZones();

    // Check current count
    const allSnap = await db.collection('parking_sessions').get();
    if (allSnap.size >= MAX_TOTAL_SESSIONS) {
        console.log(`[Generator] Session limit reached (${allSnap.size}), skipping generation`);
        return;
    }

    const batch = db.batch();
    const created = [];

    for (let i = 0; i < SESSIONS_PER_BATCH; i++) {
        const zone = ZONES[Math.floor(seededRandom() * ZONES.length)];
        const startOffset = Math.floor(seededRandom() * 3) - 1; // -1 to +2 min from now
        const duration = 30 + Math.floor(seededRandom() * 90); // 30-120 min
        const startTs = tsOffset(startOffset);
        const endTs = tsOffset(startOffset + duration);
        const loc = locationForZone(zone);
        const status = computeStatus(startTs.toMillis(), endTs.toMillis());

        const extRef = db.collection('external_payment_sessions').doc();
        batch.set(extRef, {
            vehicle_id: randomVehicleId(),
            lat: loc.lat,
            lng: loc.lng,
            start_time: startTs,
            end_time: endTs,
            duration_minutes: duration,
            status: status,
            raw_payload: { source: 'auto-generator', zone_hint: zone.id },
            received_at: tsNow(),
            updated_at: tsNow(),
        });

        const matchedZone = findZoneForCoords(loc, ZONES);
        const zoneId = matchedZone ? matchedZone.id : null;
        const isCompliant = zoneId !== null && status === 'active';

        const psRef = db.collection('parking_sessions').doc();
        batch.set(psRef, {
            external_session_id: extRef.id,
            vehicle_id: randomVehicleId(),
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

        created.push({ vehicle: randomVehicleId(), zone: zone.name, duration });
    }

    await batch.commit();
    console.log(`[Generator] Created ${SESSIONS_PER_BATCH} new sessions:`,
        created.map(c => `${c.vehicle} in ${c.zone} (${c.duration}m)`).join(', '));
}

// ---- 2. Mark expired sessions as 'completed' ----
async function markExpiredSessions() {
    const now = Date.now();
    const expiredSnap = await db.collection('parking_sessions')
        .where('status', '==', 'active')
        .get();

    let updated = 0;
    const batch = db.batch();

    for (const doc of expiredSnap.docs) {
        const s = doc.data();
        const endMs = s.end_time.toMillis ? s.end_time.toMillis() : s.end_time;
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
    const activeSnap = await db.collection('parking_sessions')
        .where('status', '==', 'active')
        .get();

    const activeByZone = {};
    let outsideCount = 0;

    for (const doc of activeSnap.docs) {
        const s = doc.data();
        const startMs = s.start_time.toMillis ? s.start_time.toMillis() : s.start_time;
        const endMs = s.end_time.toMillis ? s.end_time.toMillis() : s.end_time;
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
        const color = rate >= 80 ? 'green' : rate >= 50 ? 'orange' : 'red';

        const ref = db.collection('compliance_snapshots').doc();
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
// Target active sessions per zone (same ratios as the seed script)
const ZONE_TARGETS = {
    'zone_ss15_4':      35,  // 70% of 50  = Orange
    'zone_ss15_8':      38,  // 95% of 40  = Green
    'zone_usj10_taipan':45,  // 37.5% of 120= Red
    'zone_ss16_1':      60,  // 80% of 75  = Green
    'zone_ss17_1e':     24,  // 60% of 40  = Orange
    'zone_ss17_1b':      5,  // 17% of 30  = Red
};

async function populateMissingSessions() {
    if (ZONES.length === 0) await loadZones();

    const now = Date.now();
    const activeSnap = await db.collection('parking_sessions')
        .where('status', '==', 'active')
        .get();

    const activeByZone = {};
    for (const doc of activeSnap.docs) {
        const s = doc.data();
        const endMs = s.end_time.toMillis ? s.end_time.toMillis() : s.end_time;
        if (now > endMs) continue; // skip truly expired (shouldn't happen, but safety)
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
            const startOffset = -Math.floor(seededRandom() * 30); // Started 0-30 min ago
            const duration = 30 + Math.floor(seededRandom() * 90); // 30-120 min
            const startTs = tsOffset(startOffset);
            const endTs = tsOffset(startOffset + duration);
            const loc = locationForZone(zone);
            const status = computeStatus(startTs.toMillis(), endTs.toMillis());

            const extRef = db.collection('external_payment_sessions').doc();
            batch.set(extRef, {
                vehicle_id: randomVehicleId(),
                lat: loc.lat,
                lng: loc.lng,
                start_time: startTs,
                end_time: endTs,
                duration_minutes: duration,
                status: status,
                raw_payload: { source: 'auto-generator', zone_hint: zone.id },
                received_at: tsNow(),
                updated_at: tsNow(),
            });

            const matchedZone = findZoneForCoords(loc, ZONES);
            const zoneId = matchedZone ? matchedZone.id : null;
            const isCompliant = zoneId !== null && status === 'active';

            const psRef = db.collection('parking_sessions').doc();
            batch.set(psRef, {
                external_session_id: extRef.id,
                vehicle_id: randomVehicleId(),
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
