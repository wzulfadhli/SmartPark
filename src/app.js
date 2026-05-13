// ============================================================
// GPS/Geofencing Parking System Core Logic
// ============================================================
// This system replaces physical parking sensors with GPS-based
// geofencing and payment session tracking. Occupancy is now
// determined by active payment sessions within geofenced zones.
// ============================================================

const APP_VERSION = (typeof SP_CONFIG !== 'undefined') ? SP_CONFIG.APP_VERSION : '2.2.0';
const DB_NAME = 'SmartParkingDB_GPS';

// ============================================================
// DATA MODE FLAGS
// ============================================================
// USE_DUMMY_DATA  = true  → generate sessions in-browser (no real payment data)
// USE_DUMMY_ZONES = true  → use ZONE_DEFINITIONS from zones-config.js
//                   false → load zones from Firestore (hybrid mode)
// ============================================================
const USE_DUMMY_DATA  = (typeof SP_CONFIG !== 'undefined') ? SP_CONFIG.USE_DUMMY_DATA  : true;
const USE_DUMMY_ZONES = (typeof SP_CONFIG !== 'undefined' && SP_CONFIG.USE_DUMMY_ZONES !== undefined)
    ? SP_CONFIG.USE_DUMMY_ZONES : true;

// Firebase config — read from centralized SP_CONFIG (config.js)
const FIREBASE_CONFIG = (typeof SP_CONFIG !== 'undefined' && SP_CONFIG.FIREBASE)
    ? SP_CONFIG.FIREBASE
    : { apiKey: '', authDomain: '', projectId: '', storageBucket: '', messagingSenderId: '', appId: '' };

// Firebase Firestore references (set after init)
let firebaseDB = null;
let firestore = null;
let zonesRef = null;
let paymentSessionsRef = null;
let complianceSnapshotsRef = null;
let dailySummaryRef = null;

// IndexedDB for offline fallback
let db;

function initDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 3);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // Payment sessions store (replaces old parkingSessions)
            if (!db.objectStoreNames.contains('paymentSessions')) {
                const s = db.createObjectStore('paymentSessions', { keyPath: 'sessionId' });
                s.createIndex('vehicleId', 'vehicleId', { unique: false });
                s.createIndex('status', 'status', { unique: false });
                s.createIndex('startTime', 'startTime', { unique: false });
            }
            // Zones store for offline zone definitions
            if (!db.objectStoreNames.contains('zones')) {
                const z = db.createObjectStore('zones', { keyPath: 'id' });
            }
            // Compliance snapshots store
            if (!db.objectStoreNames.contains('complianceSnapshots')) {
                const c = db.createObjectStore('complianceSnapshots', { keyPath: 'id', autoIncrement: true });
                c.createIndex('zoneId', 'zoneId', { unique: false });
                c.createIndex('timestamp', 'timestamp', { unique: false });
            }
            // Offline queue for sync
            if (!db.objectStoreNames.contains('offlineQueue')) {
                db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
            }
            // Push subscriptions
            if (!db.objectStoreNames.contains('pushSubscriptions')) {
                db.createObjectStore('pushSubscriptions', { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

async function saveOfflineData(storeName, data) {
    if (!db) await initDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const record = {
            ...data,
            timestamp: data.timestamp || new Date().toISOString(),
            synced: data.synced || false
        };
        const request = store.put(record);
        request.onsuccess = async () => {
            if (!data.id) data.id = request.result;
            if (!navigator.onLine && storeName !== 'offlineQueue') {
                await saveOfflineData('offlineQueue', {
                    action: 'sync',
                    store: storeName,
                    dataId: data.id,
                    data: record
                });
            }
            resolve(request.result);
        };
        request.onerror = () => reject(request.error);
    });
}

async function loadOfflineData(storeName) {
    if (!db) await initDatabase();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ============================================================
// ZONE CONFIGURATION (replaces old Parking Bay Configuration)
// ============================================================
// These are geofenced parking zones. In production, these would
// be loaded from Firestore. This replaces the sensor-based bays.
// ============================================================

let zones = [];
let paymentSessions = [];
let complianceSnapshots = [];

// Compliance thresholds (configurable)
const COMPLIANCE_THRESHOLDS = {
    HIGH: 80,    // >= 80% = Green
    MEDIUM: 50   // 50-79% = Orange, < 50% = Red
};

// Expose zones, payment sessions, and Firebase refs as window globals
window.ZONES = zones;
window.PAYMENT_SESSIONS = paymentSessions;
window.COMPLIANCE_SNAPSHOTS = complianceSnapshots;
window.firebaseDB = null; // set after initFirebase
Object.defineProperty(window, 'zones', { get: () => zones, set: v => { zones = v; } });
Object.defineProperty(window, 'paymentSessions', { get: () => paymentSessions, set: v => { paymentSessions = v; } });
Object.defineProperty(window, 'complianceSnapshots', { get: () => complianceSnapshots, set: v => { complianceSnapshots = v; } });

// ============================================================
// FIREBASE INIT & REALTIME LISTENERS (Firestore)
// ============================================================

function initFirebase() {
    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        firestore = firebase.firestore();
        window.firebaseDB = firestore;

        // Firestore collection references (match schema)
        zonesRef = firestore.collection('zones');
        paymentSessionsRef = firestore.collection('parking_sessions');
        complianceSnapshotsRef = firestore.collection('compliance_snapshots');
        dailySummaryRef = firestore.collection('daily_summary');

        // Listen for real-time zone changes
        zonesRef.onSnapshot((snapshot) => {
            console.log('[Firebase] Zones snapshot received:', snapshot.size, 'documents');
            zones = [];
            snapshot.forEach(doc => {
                zones.push({ id: doc.id, ...doc.data() });
            });
            window.ZONES = zones;
            console.log('[Firebase] window.ZONES set:', window.ZONES.length, 'zones');

            // Hybrid mode: zones from Firestore, sessions generated in-browser
            if (USE_DUMMY_DATA && typeof DummyData !== 'undefined') {
                console.log('[Hybrid] Regenerating dummy sessions for', zones.length, 'Firestore zones');
                const result = DummyData.generateSessions(zones);
                paymentSessions = result.sessions;
                window.PAYMENT_SESSIONS = paymentSessions;
            }

            updateAll();
            window.dispatchEvent(new CustomEvent('parkingDataUpdated'));
        }, (err) => {
            console.error('[Firebase] Zones listener error:', err);
        });

        // In hybrid mode (USE_DUMMY_DATA=true), sessions are generated locally
        // so we skip the payment sessions and compliance listeners.
        if (!USE_DUMMY_DATA) {
            // Listen for real-time payment session changes
            paymentSessionsRef
                .onSnapshot((snapshot) => {
                    console.log('[Firebase] Payment sessions snapshot received:', snapshot.size, 'documents');
                    paymentSessions = [];
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        const startMs = toMillis(data.start_time);
                        const endMs = toMillis(data.end_time);

                        paymentSessions.push({
                            ...data,
                            id: doc.id,
                            start_time: startMs,
                            end_time: endMs,
                            status: computeStatus(startMs, endMs),
                            created_at: toMillis(data.created_at),
                            updated_at: toMillis(data.updated_at)
                        });
                    });
                    window.PAYMENT_SESSIONS = paymentSessions;
                    console.log('[Firebase] window.PAYMENT_SESSIONS set:', window.PAYMENT_SESSIONS.length, 'sessions');
                    calculateAndStoreCompliance();
                    updateAll();
                    window.dispatchEvent(new CustomEvent('parkingDataUpdated'));
                }, (err) => {
                    console.error('[Firebase] Payment sessions listener error:', err);
                });

            // Listen for real-time compliance snapshot changes
            complianceSnapshotsRef
                .orderBy('timestamp', 'desc')
                .limit(100)
                .onSnapshot((snapshot) => {
                    complianceSnapshots = [];
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        complianceSnapshots.push({
                            ...data,
                            id: doc.id,
                            timestamp: toMillis(data.timestamp),
                            created_at: toMillis(data.created_at)
                        });
                    });
                    window.dispatchEvent(new CustomEvent('parkingDataUpdated'));
                });
        } else {
            console.log('[Hybrid] Skipping sessions & compliance listeners — using dummy data');
        }

        console.log('[Firebase] Firestore realtime listeners attached');
        return true;
    } catch (err) {
        console.error('[Firebase] Init failed:', err);
        showNotification('Firebase not configured. Running in local-only mode.', 'warning');
        return false;
    }
}

// Write a payment session to Firestore
async function syncPaymentSessionToFirebase(session) {
    if (!paymentSessionsRef) return;
    try {
        await paymentSessionsRef.doc(session.id).set(session);
    } catch (err) {
        console.error('[Firebase] Failed to sync payment session:', err);
        await saveOfflineData('offlineQueue', {
            action: 'syncPaymentSession',
            data: session,
            timestamp: new Date().toISOString()
        });
    }
}

// Write a compliance snapshot to Firestore
async function syncComplianceSnapshotToFirebase(snapshot) {
    if (!complianceSnapshotsRef) return;
    try {
        await complianceSnapshotsRef.add(snapshot);
    } catch (err) {
        console.error('[Firebase] Failed to sync compliance snapshot:', err);
        await saveOfflineData('offlineQueue', {
            action: 'syncComplianceSnapshot',
            data: snapshot,
            timestamp: new Date().toISOString()
        });
    }
}

// ============================================================
// APP INIT
// ============================================================

async function initializeApp() {
    console.log('Initializing GPS/Geofencing Parking System v' + APP_VERSION);
    console.log('[Config] USE_DUMMY_DATA=' + USE_DUMMY_DATA + ', USE_DUMMY_ZONES=' + USE_DUMMY_ZONES);

    await initDatabase();

    // ---- Fully offline demo (zones + sessions from JS) ----
    if (USE_DUMMY_DATA && USE_DUMMY_ZONES) {
        console.log('[Demo] Full dummy mode (zones + sessions from JS)');
        loadDummyData();
        updateStats();
        startComplianceCalculation();
        showNotification('GPS Parking System Ready (Demo Mode)', 'success');
        return;
    }

    // ---- Hybrid: zones from Firestore, sessions generated in-browser ----
    if (USE_DUMMY_DATA && !USE_DUMMY_ZONES) {
        console.log('[Hybrid] Zones from Firestore, sessions generated in-browser');
        const firebaseReady = initFirebase();
        if (!firebaseReady) {
            console.warn('[Hybrid] Firebase init failed — falling back to local zones');
            loadDummyData();
        }
        // Sessions will be generated when the zones onSnapshot fires
        updateStats();
        startComplianceCalculation();
        showNotification('GPS Parking System Ready (Hybrid Mode)', 'success');
        return;
    }

    // ---- Full Firebase (zones + sessions from Firestore) ----
    const firebaseReady = initFirebase();
    if (!firebaseReady) {
        await loadCachedState();
    }
    if (zones.length === 0 && typeof ZONE_DEFINITIONS !== 'undefined') {
        zones = ZONE_DEFINITIONS;
        window.ZONES = zones;
        console.log('[Fallback] Using local zone definitions');
    }

    updateStats();
    startComplianceCalculation();
    updateThemeIcon();
    showNotification('GPS Parking System Ready', 'success');
}

async function loadCachedState() {
    try {
        const cachedSessions = await loadOfflineData('paymentSessions');
        const cachedZones = await loadOfflineData('zones');

        if (cachedSessions.length > 0) {
            paymentSessions = cachedSessions.filter(s => s.status === 'active');
        }

        if (cachedZones.length > 0) {
            zones = cachedZones;
        }

        console.log('Loaded cached data:', { sessions: cachedSessions.length, zones: cachedZones.length });
    } catch (error) {
        console.error('Failed to load cached data:', error);
    }
}

// Load dummy data for demo (zones + sessions from JS globals)
function loadDummyData() {
    // If DummyData hasn't auto-generated yet (USE_DUMMY_ZONES was false at load),
    // generate now with whatever zones are available.
    if (typeof DummyData !== 'undefined' && typeof DUMMY_ZONES === 'undefined') {
        var srcZones = (typeof ZONE_DEFINITIONS !== 'undefined') ? ZONE_DEFINITIONS : [];
        DummyData.generateSessions(srcZones);
    }
    if (typeof DUMMY_ZONES !== 'undefined') {
        zones = DUMMY_ZONES;
        window.ZONES = DUMMY_ZONES;
        console.log('[Demo] Loaded dummy zones:', zones.length);
    }
    if (typeof DUMMY_PAYMENT_SESSIONS !== 'undefined') {
        paymentSessions = DUMMY_PAYMENT_SESSIONS;
        window.PAYMENT_SESSIONS = DUMMY_PAYMENT_SESSIONS;
        console.log('[Demo] Loaded dummy payment sessions:', paymentSessions.length);
    }
}

// loadSampleZones removed — zone definitions now live in zones-config.js
// and are loaded via ZONE_DEFINITIONS global or Firestore.

// ============================================================
// PUSH NOTIFICATIONS & BACKGROUND SYNC
// ============================================================

async function setupPushNotifications() {
    if (!('Notification' in window)) return;
    const VAPID_KEY = 'YOUR_PUBLIC_VAPID_KEY';
    if (VAPID_KEY === 'YOUR_PUBLIC_VAPID_KEY' || !VAPID_KEY) {
        console.log('VAPID key not configured. Using local notifications only.');
        return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted' && 'serviceWorker' in navigator && 'PushManager' in window) {
        const registration = await navigator.serviceWorker.ready;
        try {
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_KEY)
            });
            console.log('Push subscription:', subscription);
        } catch (error) {
            console.error('Failed to subscribe to push:', error);
        }
    }
}

async function setupBackgroundSync() {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    if ('SyncManager' in window) {
        try {
            await registration.sync.register('sync-parking-data');
        } catch (error) {
            console.error('Background sync failed:', error);
        }
    }
    if ('periodicSync' in registration) {
        try {
            await registration.periodicSync.register('check-parking-status', {
                minInterval: 5 * 60 * 1000
            });
        } catch (error) {
            console.error('Periodic sync failed:', error);
        }
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// ============================================================
// PAYMENT SESSION MANAGEMENT (replaces old Parking Session Logic)
// ============================================================

/**
 * Create a new payment session
 * This replaces the old sensor-based parking session start
 * @param {string} zoneId - Zone ID where parking occurs
 * @param {string} vehicleId - Vehicle identifier
 * @param {Object} location - GPS coordinates {lat, lng}
 * @param {number} durationMinutes - Parking duration in minutes
 */
async function createPaymentSession(zoneId, vehicleId, location, durationMinutes) {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) {
        showNotification('Invalid zone', 'danger');
        return;
    }

    // Validate location is within geofence
    if (!isWithinGeofence(location, zone)) {
        showNotification('Location is outside the parking zone', 'danger');
        return;
    }

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const session = {
        id: sessionId,
        vehicle_id: vehicleId,
        lat: location.lat,
        lng: location.lng,
        zone_id: zoneId,
        start_time: now,
        end_time: now + (durationMinutes * 60 * 1000),
        duration_minutes: durationMinutes,
        status: 'active',
        is_compliant: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    // Sync to Firestore
    await syncPaymentSessionToFirebase(session);
    await saveOfflineData('paymentSessions', session);

    showNotification(`Payment session started in ${zone.name}`, 'success');
    if ('vibrate' in navigator) navigator.vibrate(50);

    return session;
}

/**
 * End a payment session
 * This replaces the old sensor-based parking session end
 * @param {string} sessionId - Session ID to end
 */
async function endPaymentSession(sessionId) {
    const session = paymentSessions.find(s => s.id === sessionId);
    if (!session) {
        showNotification('Session not found', 'danger');
        return;
    }

    session.status = 'completed';
    session.end_time = Date.now();
    session.updated_at = new Date().toISOString();

    await syncPaymentSessionToFirebase(session);
    await saveOfflineData('paymentSessions', session);

    showNotification(`Payment session ended`, 'success');
    if ('vibrate' in navigator) navigator.vibrate([50, 50, 50]);
}

/**
 * Cancel a payment session
 * @param {string} sessionId - Session ID to cancel
 */
async function cancelPaymentSession(sessionId) {
    const session = paymentSessions.find(s => s.id === sessionId);
    if (!session) {
        showNotification('Session not found', 'danger');
        return;
    }

    session.status = 'cancelled';
    session.updated_at = new Date().toISOString();

    await syncPaymentSessionToFirebase(session);
    await saveOfflineData('paymentSessions', session);

    showNotification(`Payment session cancelled`, 'warning');
}

// ============================================================
// COMPLIANCE CALCULATION (replaces old Violation Logic)
// ============================================================

/**
 * Calculate compliance for all zones and store snapshots
 * This replaces the old violation detection system
 */
function calculateAndStoreCompliance() {
    const currentTime = Date.now();

    // Bucket sessions into the zone that GPS-contains them, ignoring stored zone_id.
    // Only sessions that are active AND currently within their time window are counted.
    const activeByZone = {};
    paymentSessions.forEach(session => {
        if (session.status !== 'active') return;
        if (currentTime < session.start_time || currentTime > session.end_time) return;
        const containingZone = (session.lat != null && session.lng != null)
            ? findZoneForCoords({ lat: session.lat, lng: session.lng }, zones)
            : null;
        if (!containingZone) return;
        activeByZone[containingZone.id] = (activeByZone[containingZone.id] || 0) + 1;
    });

    zones.forEach(zone => {
        const activeCount = activeByZone[zone.id] || 0;
        const complianceRate = calculateComplianceRate(activeCount, zone.totalLots);
        const statusColor = getComplianceStatusColor(complianceRate, COMPLIANCE_THRESHOLDS);

        const snapshot = {
            zone_id: zone.id,
            zone_name: zone.name,
            timestamp: currentTime,
            active_sessions: activeCount,
            total_lots: zone.totalLots,
            compliance_rate: complianceRate,
            status_color: statusColor,
            created_at: new Date().toISOString()
        };

        // Sync to Firestore
        syncComplianceSnapshotToFirebase(snapshot);
    });

}

// calculateComplianceRate, getComplianceStatusColor → compliance-utils.js
// isWithinGeofence, calculateDistance, findZoneForCoords → geofencing-utils.js
// (Both files must be loaded before app.js in the host page.)

/**
 * Start periodic compliance calculation
 */
function startComplianceCalculation() {
    // Calculate immediately
    calculateAndStoreCompliance();

    // Calculate every 30 seconds
    setInterval(calculateAndStoreCompliance, 30000);
}


// ============================================================
// HISTORICAL DATA — compliance snapshots, daily summaries
// ============================================================

async function incrementDailySessions() {
    if (!dailySummaryRef) return;
    const today = new Date().toISOString().split('T')[0];
    try {
        const docRef = dailySummaryRef.doc(today);
        await docRef.set({
            date: today,
            totalSessions: firebase.firestore.FieldValue.increment(1)
        }, { merge: true });
    } catch (e) { console.warn('[Firebase] incrementDailySessions failed:', e); }
}

async function incrementDailyFees(fee) {
    if (!dailySummaryRef) return;
    const today = new Date().toISOString().split('T')[0];
    try {
        const docRef = dailySummaryRef.doc(today);
        await docRef.set({
            date: today,
            feesCollected: firebase.firestore.FieldValue.increment(fee)
        }, { merge: true });
    } catch (e) { console.warn('[Firebase] incrementDailyFees failed:', e); }
}

// ============================================================
// UI UPDATES
// ============================================================

function updateStats() {
    const now = Date.now();
    const totalLots = zones.reduce((sum, zone) => sum + zone.totalLots, 0);
    const activeSessionsCount = paymentSessions.filter(s =>
        s.status === 'active' && now >= s.start_time && now <= s.end_time
    ).length;

    // Calculate overall compliance based on GPS location within geofences (time-window aware)
    let totalCompliance = 0;
    zones.forEach(zone => {
        const activeInZone = paymentSessions.filter(s => {
            if (s.status !== 'active') return false;
            if (now < s.start_time || now > s.end_time) return false;
            if (s.lat == null || s.lng == null) return false;
            return isWithinGeofence({ lat: s.lat, lng: s.lng }, zone);
        }).length;
        totalCompliance += calculateComplianceRate(activeInZone, zone.totalLots);
    });
    const avgCompliance = zones.length > 0 ? totalCompliance / zones.length : 0;

    $('#totalZones').text(zones.length);
    $('#totalLots').text(totalLots);
    $('#activeSessions').text(activeSessionsCount);
    $('#avgCompliance').text(avgCompliance.toFixed(1) + '%');
}


function showNotification(message, type = 'info') {
    const bgClass = {
        'info': 'bg-primary',
        'success': 'bg-success',
        'warning': 'bg-warning',
        'danger': 'bg-danger'
    }[type] || 'bg-info';

    const toast = `
        <div class="toast show align-items-center text-white ${bgClass} bg-opacity-50 border-0 mb-2" role="alert">
            <div class="d-flex">
                <div class="toast-body small">
                    <i class="bi bi-info-circle me-2"></i>${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;
    $('#notificationContainer').append(toast);
    setTimeout(() => {
        $('#notificationContainer .toast').first().fadeOut(300, function () { $(this).remove(); });
    }, 4000);
}

/**
 * Simulate a random payment session for demo purposes
 * This replaces the old simulateRandomCar function
 */
function simulateRandomPaymentSession() {
    if (zones.length === 0) {
        showNotification('No zones available', 'warning');
        return;
    }

    const randomZone = zones[Math.floor(Math.random() * zones.length)];
    const vehicleId = `VEH_${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
    const location = randomZone.center;
    const duration = Math.floor(Math.random() * 60) + 30; // 30-90 minutes

    createPaymentSession(randomZone.id, vehicleId, location, duration);
}

/**
 * Reset all payment sessions
 * This replaces the old resetAllBays function
 */
async function resetAllSessions() {
    if (!confirm('Reset all payment sessions?')) return;

    paymentSessions = [];
    window.PAYMENT_SESSIONS = paymentSessions;

    // Clear Firebase
    if (paymentSessionsRef) {
        const snapshot = await paymentSessionsRef.get();
        const batch = firestore.batch();
        snapshot.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
    }

    // Clear IndexedDB
    if (db) {
        const transaction = db.transaction(['paymentSessions'], 'readwrite');
        await transaction.objectStore('paymentSessions').clear();
    }

    // In dummy mode, repopulate so the demo keeps showing meaningful data
    if (USE_DUMMY_DATA) {
        loadDummyData();
    }

    updateAll();
    showNotification('System reset complete', 'info');
}

function refreshData() { updateAll(); }

function updateAll() {
    updateStats();
    // Notify iframe pages to re-render their own UI
    window.dispatchEvent(new CustomEvent('parkingDataUpdated'));
}

// Online/offline
window.addEventListener('online', () => {
    const ind = document.getElementById('offlineIndicator');
    if (ind) ind.classList.remove('show');
    showNotification('Back online', 'success');
    syncOfflineQueue();
});

window.addEventListener('offline', () => {
    const ind = document.getElementById('offlineIndicator');
    if (ind) ind.classList.add('show');
    showNotification('Offline mode - Data will sync when online', 'warning');
});

async function syncOfflineQueue() {
    try {
        const offlineQueue = await loadOfflineData('offlineQueue');
        for (let item of offlineQueue) {
            console.log('Processing queued item:', item);
            if (item.action === 'syncPaymentSession' && paymentSessionsRef) {
                await paymentSessionsRef.doc(item.data.id).set(item.data);
            }
            if (item.action === 'syncComplianceSnapshot' && complianceSnapshotsRef) {
                await complianceSnapshotsRef.add(item.data);
            }
        }
        if (offlineQueue.length > 0) {
            const tx = db.transaction(['offlineQueue'], 'readwrite');
            tx.objectStore('offlineQueue').clear();
            showNotification('Offline data synchronized', 'success');
        }
    } catch (error) {
        console.error('Sync failed:', error);
    }
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshData();
});

// Theme
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const currentTheme = theme || document.documentElement.getAttribute('data-theme') || 'light';
    const icon = document.getElementById('themeIcon');
    if (icon) {
        icon.className = currentTheme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
    }
}

// Expose functions for global access
window.createPaymentSession = createPaymentSession;
window.endPaymentSession = endPaymentSession;
window.cancelPaymentSession = cancelPaymentSession;
window.simulateRandomPaymentSession = simulateRandomPaymentSession;
window.resetAllSessions = resetAllSessions;
window.refreshData = refreshData;
window.toggleTheme = toggleTheme;

// Boot
$(document).ready(() => {
    initializeApp();
});
