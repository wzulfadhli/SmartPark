// Parking System Core Logic
const APP_VERSION = '1.0.0';
const DB_NAME = 'SmartParkingDB';

// ============================================================
// FIREBASE CONFIGURATION
// Replace the values below with your own Firebase project config.
// Go to: https://console.firebase.google.com → Your Project →
// Project Settings → Your Apps → Firebase SDK snippet → Config
// ============================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBiOLREiC_2EvhVuaLu9duJGedYxvM1yg8",
  authDomain: "smartpark-26.firebaseapp.com",
  databaseURL: "https://smartpark-26-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smartpark-26",
  storageBucket: "smartpark-26.firebasestorage.app",
  messagingSenderId: "259377487081",
  appId: "1:259377487081:web:bf424b51abb59ca7c32478"
};
// ============================================================

// Firebase references (set after init)
let firebaseDB = null;
let sessionsRef = null;
let violationsRef = null;

// IndexedDB for offline fallback
let db;

function initDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('parkingSessions')) {
                const s = db.createObjectStore('parkingSessions', { keyPath: 'id', autoIncrement: true });
                s.createIndex('bayId', 'bayId', { unique: false });
                s.createIndex('status', 'status', { unique: false });
            }
            if (!db.objectStoreNames.contains('violations')) {
                const v = db.createObjectStore('violations', { keyPath: 'id', autoIncrement: true });
                v.createIndex('bayId', 'bayId', { unique: false });
                v.createIndex('status', 'status', { unique: false });
                v.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!db.objectStoreNames.contains('offlineQueue')) {
                db.createObjectStore('offlineQueue', { keyPath: 'id', autoIncrement: true });
            }
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

// Parking Bay Configuration
const bays = [
    { id: 1, number: 'A01', type: '2 min', maxMinutes: 2, sensorId: 'SENSOR_001', location: 'Level 1' },
    { id: 2, number: 'A02', type: '2 min', maxMinutes: 2, sensorId: 'SENSOR_002', location: 'Level 1' },
    { id: 3, number: 'A03', type: '5 min', maxMinutes: 5, sensorId: 'SENSOR_003', location: 'Level 1' },
    { id: 4, number: 'A04', type: '5 min', maxMinutes: 5, sensorId: 'SENSOR_004', location: 'Level 1' },
    { id: 5, number: 'B01', type: '2 min', maxMinutes: 2, sensorId: 'SENSOR_005', location: 'Level 2' },
    { id: 6, number: 'B02', type: '2 min', maxMinutes: 2, sensorId: 'SENSOR_006', location: 'Level 2' },
    { id: 7, number: 'B03', type: '5 min', maxMinutes: 5, sensorId: 'SENSOR_007', location: 'Level 2' },
    { id: 8, number: 'B04', type: '5 min', maxMinutes: 5, sensorId: 'SENSOR_008', location: 'Level 2' }
];

// Local state — always kept in sync with Firebase
// Exposed on window so dashboard.html (same origin iframe) can read them
let activeSessions = {};
let violations = [];
let enforcerAlerts = [];

// Expose bay config and state as window globals for cross-page reads
window.BAYS = bays;
Object.defineProperty(window, 'activeSessions', { get: () => activeSessions, set: v => { activeSessions = v; } });
Object.defineProperty(window, 'violations',     { get: () => violations,     set: v => { violations = v; } });

// ============================================================
// FIREBASE INIT & REALTIME LISTENERS
// ============================================================

function initFirebase() {
    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        firebaseDB = firebase.database();
        sessionsRef = firebaseDB.ref('activeSessions');
        violationsRef = firebaseDB.ref('violations');

        // Listen for real-time session changes from ANY device
        sessionsRef.on('value', (snapshot) => {
            const data = snapshot.val() || {};
            activeSessions = data;
            updateAll();
        });

        // Listen for real-time violation changes from ANY device
        violationsRef.on('value', (snapshot) => {
            const data = snapshot.val();
            violations = data ? Object.values(data) : [];
            updateEnforcerPanel();
            updateStats();
        });

        console.log('[Firebase] Realtime listeners attached');
        return true;
    } catch (err) {
        console.error('[Firebase] Init failed:', err);
        showNotification('Firebase not configured. Running in local-only mode.', 'warning');
        return false;
    }
}

// Write active sessions to Firebase
async function syncSessionsToFirebase() {
    if (!sessionsRef) return;
    try {
        await sessionsRef.set(activeSessions);
    } catch (err) {
        console.error('[Firebase] Failed to sync sessions:', err);
        // Fall back to offline queue
        await saveOfflineData('offlineQueue', {
            action: 'syncSessions',
            data: activeSessions,
            timestamp: new Date().toISOString()
        });
    }
}

// Write a single violation to Firebase
async function syncViolationToFirebase(violation) {
    if (!violationsRef) return;
    try {
        await violationsRef.child(String(violation.id)).set(violation);
    } catch (err) {
        console.error('[Firebase] Failed to sync violation:', err);
        await saveOfflineData('offlineQueue', {
            action: 'syncViolation',
            data: violation,
            timestamp: new Date().toISOString()
        });
    }
}

// ============================================================
// APP INIT
// ============================================================

async function initializeApp() {
    console.log('Initializing Smart Parking PWA v' + APP_VERSION);

    await initDatabase();
    const firebaseReady = initFirebase();

    // If Firebase isn't configured yet, fall back to cached local state
    if (!firebaseReady) {
        await loadCachedState();
    }

    renderBays();
    updateStats();
    updateActiveSessionsTable();
    updateEnforcerPanel();

    startTimers();
    startEnforcerCheck();
    setupPushNotifications();
    setupBackgroundSync();
    updateThemeIcon();

    showNotification('Smart Parking System Ready', 'success');
}

async function loadCachedState() {
    try {
        const cachedSessions = await loadOfflineData('parkingSessions');
        const cachedViolations = await loadOfflineData('violations');

        if (cachedSessions.length > 0) {
            cachedSessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            cachedSessions.forEach(session => {
                if (session.status === 'active' && !activeSessions[session.bayId]) {
                    activeSessions[session.bayId] = session;
                }
            });
        }

        if (cachedViolations.length > 0) {
            violations = cachedViolations.filter(v => !v.compounded);
        }

        console.log('Loaded cached data:', { sessions: cachedSessions.length, violations: cachedViolations.length });
    } catch (error) {
        console.error('Failed to load cached data:', error);
    }
}

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
// PARKING SESSION LOGIC
// ============================================================

function renderBays() {
    const grid = $('#baysGrid');
    grid.empty();

    bays.forEach(bay => {
        const session = activeSessions[bay.id];
        let statusClass = 'bay-available';

        if (session) {
            const elapsed = Math.floor((Date.now() - session.startTime) / 60000);
            statusClass = elapsed > bay.maxMinutes ? 'bay-violation' : 'bay-occupied';
        }

        const card = `
            <div class="col-4 col-md-2 mb-2">
                <div class="card bay-card ${statusClass} h-80" onclick="toggleBay(${bay.id})">
                    <div class="status-dot" style="width: 8px; height: 8px;"></div>
                    <div class="mb-1 text-muted small fw-bold" style="font-size: 0.65rem;">
                        ${bay.location}-${bay.number}
                    </div>
                    <h3 class="mb-0 fw-bold" style="color: var(--text-primary); font-size: 1.3rem; letter-spacing: -1px;">
                        ${bay.number}
                    </h3>
                    <div class="mt-auto pt-2 d-flex justify-content-between align-items-end">
                        <small class="text-muted" style="font-size: 0.6rem;">${bay.location}<br>${bay.type}</small>
                    </div>
                </div>
            </div>
        `;
        grid.append(card);
    });
}

async function toggleBay(bayId) {
    if (activeSessions[bayId]) {
        await endParkingSession(bayId);
    } else {
        await startParkingSession(bayId);
    }
}

async function startParkingSession(bayId) {
    const bay = bays.find(b => b.id === bayId);

    const session = {
        bayId: bayId,
        bayNumber: bay.number,
        bayType: bay.type,
        maxMinutes: bay.maxMinutes,
        startTime: Date.now(),
        sensorId: bay.sensorId,
        enforcerNotified: false,
        status: 'active'
    };

    // Write to Firebase — all devices will see this instantly via the listener
    activeSessions[bayId] = session;
    await syncSessionsToFirebase();

    // Also persist locally for offline support
    await saveOfflineData('parkingSessions', session);

    showNotification(`Vehicle parked at Bay ${bay.number} (${bay.type})`, 'info');
    if ('vibrate' in navigator) navigator.vibrate(50);
}

async function endParkingSession(bayId) {
    const session = activeSessions[bayId];
    if (!session) return;

    const bay = bays.find(b => b.id === bayId);
    const duration = Math.floor((Date.now() - session.startTime) / 60000);

    if (duration > bay.maxMinutes) {
        showNotification(`Vehicle left Bay ${bay.number} after ${duration} min (OVERSTAY)`, 'warning');
    } else {
        showNotification(`Vehicle left Bay ${bay.number} after ${duration} min`, 'success');
    }

    session.status = 'completed';
    session.endTime = Date.now();
    session.duration = duration;
    await saveOfflineData('parkingSessions', session);

    delete activeSessions[bayId];

    // Push deletion to Firebase — all devices update instantly
    await syncSessionsToFirebase();

    if ('vibrate' in navigator) navigator.vibrate([50, 50, 50]);
}

function getProgress(bayId) {
    const numericId = parseInt(bayId);
    const session = activeSessions[bayId];
    if (!session) return 0;
    const bay = bays.find(b => b.id === numericId);
    if (!bay) return 0;
    const elapsed = Math.floor((Date.now() - session.startTime) / 60000);
    return Math.min(100, (elapsed / bay.maxMinutes) * 100);
}

function formatTime(bayId) {
    const numericId = parseInt(bayId);
    const session = activeSessions[bayId];
    if (!session) return '0:00';
    const bay = bays.find(b => b.id === numericId);
    if (!bay) return '0:00';

    const totalSeconds = Math.floor((Date.now() - session.startTime) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const limitSeconds = bay.maxMinutes * 60;
    const pad = (num) => num.toString().padStart(2, '0');

    if (totalSeconds > limitSeconds) {
        const overstaySeconds = totalSeconds - limitSeconds;
        const overstayM = Math.floor(overstaySeconds / 60);
        const overstayS = overstaySeconds % 60;
        return `+${overstayM}:${pad(overstayS)}`;
    }
    return `${minutes}:${pad(seconds)} / ${bay.maxMinutes}m`;
}

// ============================================================
// VIOLATION LOGIC
// ============================================================

async function triggerEnforcerAlert(bayId) {
    const numericBayId = parseInt(bayId);
    const session = activeSessions[bayId];
    const bay = bays.find(b => b.id === numericBayId);

    if (!session || !bay) return;

    // Guard: prevent duplicate violations — coerce both sides to number to avoid "1" !== 1 mismatch
    if (violations.some(v => Number(v.bayId) === Number(bayId) && !v.compounded)) return;

    const elapsed = Math.floor((Date.now() - session.startTime) / 60000);
    const overstay = elapsed - bay.maxMinutes;

    try { document.getElementById('alertSound').play(); } catch (e) {}
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200, 100, 200]);

    const violation = {
        id: Date.now(),
        bayId: bayId,
        bayNumber: bay.number,
        bayLocation: bay.location,
        overstayMinutes: overstay,
        time: new Date().toISOString(),
        status: 'pending',
        compounded: false,
        timestamp: new Date().toISOString()
    };

    violations.push(violation);
    enforcerAlerts.push(violation);

    // Sync violation to Firebase — all devices see it
    await syncViolationToFirebase(violation);
    await saveOfflineData('violations', violation);

    if ('Notification' in window && Notification.permission === 'granted') {
        const registration = await navigator.serviceWorker.ready;
        registration.showNotification('🚨 Parking Violation Alert!', {
            body: `Bay ${bay.number} has exceeded time limit by ${overstay} minutes`,
            icon: '/icons/icon-192x192.png',
            tag: `violation-${bayId}`,
            renotify: true,
            data: { url: '/', bayId: bayId }
        });
    }

    showNotification(`🚨 VIOLATION: Bay ${bay.number} overstay ${overstay} minutes!`, 'danger');
}

function updateEnforcerPanel() {
    const panel = $('#enforcerPanel');
    const pendingViolations = violations.filter(v => !v.compounded);

    if (pendingViolations.length === 0) {
        panel.html('<p class="text-muted text-center small">No active violations</p>');
        $('#alertBadge').text('0');
        return;
    }

    $('#alertBadge').text(pendingViolations.length);

    let html = '';
    pendingViolations.forEach(v => {
        const fee = calculateCompoundFee(v.overstayMinutes);
        html += `
            <div class="enforcer-alert">
                <div class="d-flex justify-content-between">
                    <h6 class="mb-1">Bay ${v.bayNumber}</h6>
                    <span class="badge bg-light text-dark">+${v.overstayMinutes}m</span>
                </div>
                <p class="mb-2 small">Location: ${v.bayLocation}</p>
                <p class="mb-2 small">Fee: RM${fee}</p>
                <button class="btn btn-sm btn-light w-100" onclick="compoundViolation(${v.id})">
                    Compound
                </button>
            </div>
        `;
    });

    panel.html(html);
}

function calculateCompoundFee(overstayMinutes) {
    const hours = Math.ceil(overstayMinutes / 60);
    return 30 + (Math.max(0, hours - 1) * 10);
}

async function compoundViolation(violationId) {
    const violation = violations.find(v => v.id === violationId);
    if (!violation) return;

    violation.compounded = true;
    violation.status = 'compounded';
    violation.compoundedAt = new Date().toISOString();

    // Sync updated violation to Firebase
    await syncViolationToFirebase(violation);
    await saveOfflineData('violations', violation);

    const fee = calculateCompoundFee(violation.overstayMinutes);
    showNotification(`✅ Bay ${violation.bayNumber} compounded! Fee: RM${fee}`, 'success');
    if ('vibrate' in navigator) navigator.vibrate(100);

    updateEnforcerPanel();
    updateStats();
}

async function compoundAllViolations() {
    const pendingViolations = violations.filter(v => !v.compounded);
    for (let violation of pendingViolations) {
        violation.compounded = true;
        violation.status = 'compounded';
        violation.compoundedAt = new Date().toISOString();
        await syncViolationToFirebase(violation);
        await saveOfflineData('violations', violation);
    }
    if (pendingViolations.length > 0) {
        showNotification(`✅ Compounded ${pendingViolations.length} violation(s)`, 'success');
    }
    updateEnforcerPanel();
    updateStats();
}

// ============================================================
// UI UPDATES
// ============================================================

function updateStats() {
    const total = bays.length;
    const occupied = Object.keys(activeSessions).length;
    const available = total - occupied;
    const violationCount = violations.filter(v => !v.compounded).length;

    $('#totalBays').text(total);
    $('#availableBays').text(available);
    $('#occupiedBays').text(occupied);
    $('#violationCount').text(violationCount);
}

function updateActiveSessionsTable() {
    const tbody = $('#activeSessionsTable');
    const sessions = Object.values(activeSessions);

    if (sessions.length === 0) {
        tbody.html('<tr><td colspan="7" class="text-center text-muted">No active sessions</td></tr>');
        return;
    }

    let html = '';
    sessions.forEach(session => {
        const bay = bays.find(b => b.id === parseInt(session.bayId));
        if (!bay) return;

        const elapsedMs = Date.now() - session.startTime;
        const totalSeconds = Math.floor(elapsedMs / 1000);
        const isViolation = elapsedMs > (bay.maxMinutes * 60000);
        const timeIn = new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const pad = (num) => num.toString().padStart(2, '0');
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        const durationStr = `${pad(h)}:${pad(m)}:${pad(s)}`;

        let compoundBtn = '';
        if (isViolation) {
            const violation = violations.find(v => Number(v.bayId) === Number(session.bayId) && !v.compounded);
            if (violation) {
                compoundBtn = `
                    <button class="badge badge-pill text-white" style="background-color: var(--accent-success); padding: 6px 14px; font-weight: 500;" onclick="compoundViolation(${violation.id})" title="Compound Violation">
                        <i class="bi bi-shield-fill"></i> Compound
                    </button>
                `;
            }
        }

        html += `
            <tr class="${isViolation ? 'table-danger' : ''}">
                <td data-label="Bay ID" class="fw-bold">${bay.location}-${bay.number}</td>
                <td data-label="Location" class="text-muted">${bay.location}</td>
                <td data-label="Time In">${timeIn}</td>
                <td data-label="Duration">${durationStr}</td>
                <td data-label="Type" class="text-muted">${bay.type}</td>
                <td data-label="Status">
                    <span class="badge badge-pill text-white" style="background-color: ${isViolation ? 'var(--accent-danger)' : 'var(--accent-primary)'}; border-radius: 20px; padding: 6px 14px; font-weight: 500;">
                        ${isViolation ? 'Violation' : 'Occupied'}
                    </span>
                </td>
                <td class="text-end">
                    ${compoundBtn}
                    <button class="btn btn-sm btn-link text-danger p-0 m-0 border-0" onclick="endParkingSession(${session.bayId})" title="End Session">
                        <i class="bi bi-x-circle-fill"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.html(html);
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

function simulateRandomCar() {
    const availableBays = bays.filter(b => !activeSessions[b.id]);
    if (availableBays.length === 0) {
        showNotification('No available bays!', 'warning');
        return;
    }
    const randomBay = availableBays[Math.floor(Math.random() * availableBays.length)];
    startParkingSession(randomBay.id);
}

async function resetAllBays() {
    if (!confirm('Reset all parking bays?')) return;

    activeSessions = {};
    violations = [];
    enforcerAlerts = [];

    // Clear Firebase
    if (sessionsRef) await sessionsRef.set(null);
    if (violationsRef) await violationsRef.set(null);

    // Clear IndexedDB
    if (db) {
        const transaction = db.transaction(['parkingSessions', 'violations'], 'readwrite');
        await transaction.objectStore('parkingSessions').clear();
        await transaction.objectStore('violations').clear();
    }

    updateAll();
    showNotification('System reset complete', 'info');
}

function refreshData() { updateAll(); }

function updateAll() {
    renderBays();
    updateStats();
    updateActiveSessionsTable();
    updateEnforcerPanel();
}

function startTimers() {
    setInterval(() => {
        Object.keys(activeSessions).forEach(bayId => {
            $(`#timer-${bayId}`).text(formatTime(bayId));
            const progress = getProgress(bayId);
            $(`#timer-${bayId}`).closest('.bay-card').find('.progress-bar').css('width', progress + '%');
        });
        updateActiveSessionsTable();
        updateStats();
    }, 1000);
}

function startEnforcerCheck() {
    setInterval(() => {
        Object.keys(activeSessions).forEach(bayId => {
            const numericId = parseInt(bayId);
            const bay = bays.find(b => b.id === numericId);
            const session = activeSessions[bayId];
            if (!bay || !session) return;

            const elapsedMs = Date.now() - session.startTime;
            const limitMs = bay.maxMinutes * 60000;

            if (elapsedMs > limitMs && !session.enforcerNotified) {
                triggerEnforcerAlert(bayId);
                session.enforcerNotified = true;
            }
        });
    }, 2000);
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
            if (item.action === 'syncSessions' && sessionsRef) {
                await sessionsRef.set(item.data);
            }
            if (item.action === 'syncViolation' && violationsRef) {
                await violationsRef.child(String(item.data.id)).set(item.data);
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

window.addEventListener('beforeunload', (e) => {
    if (Object.keys(activeSessions).length > 0) {
        e.preventDefault();
        e.returnValue = 'There are active parking sessions. Are you sure you want to leave?';
    }
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

// Expose globals
window.toggleBay = toggleBay;
window.endParkingSession = endParkingSession;
window.simulateRandomCar = simulateRandomCar;
window.resetAllBays = resetAllBays;
window.compoundViolation = compoundViolation;
window.compoundAllViolations = compoundAllViolations;
window.refreshData = refreshData;
window.toggleTheme = toggleTheme;

// Boot
$(document).ready(() => {
    initializeApp();
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => registration.update());
    }
});
