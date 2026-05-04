const CACHE_NAME = 'smartpark-v7';
const DYNAMIC_CACHE = 'smartpark-dynamic-v7';

// Assets to cache on install — use relative paths for GitHub Pages subdirectory hosting
const STATIC_ASSETS = [
    './index.html',
    './monitor.html',
    './dashboard.html',
    './map.html',
    './theme.css',
    './app.js',
    './geofencing-utils.js',
    './compliance-utils.js',
    './dummy-data.js',
    './manifest.json',
    './offline.html',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css',
    'https://code.jquery.com/jquery-4.0.0-beta.min.js',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js'
];

// Install Service Worker
self.addEventListener('install', event => {
    console.log('[SW] Installing...');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching static assets');
                // Cache each asset individually so one failure doesn't break everything
                return Promise.allSettled(
                    STATIC_ASSETS.map(url =>
                        cache.add(url).catch(err => console.warn('[SW] Failed to cache:', url, err))
                    )
                );
            })
            .then(() => {
                console.log('[SW] Skip waiting');
                return self.skipWaiting();
            })
    );
});

// Activate Service Worker
self.addEventListener('activate', event => {
    console.log('[SW] Activating...');

    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cache => {
                        if (cache !== CACHE_NAME && cache !== DYNAMIC_CACHE) {
                            console.log('[SW] Deleting old cache:', cache);
                            return caches.delete(cache);
                        }
                    })
                );
            })
            .then(() => {
                console.log('[SW] Claiming clients');
                return self.clients.claim();
            })
    );
});

// Fetch Strategy Implementation
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip chrome-extension requests
    if (event.request.url.startsWith('chrome-extension://')) return;

    const url = new URL(event.request.url);

    // Strategy 1: Network First for index.html (navigation)
    // This ensures that the user always gets the latest version of the app entry point
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                    return response;
                })
                .catch(() => caches.match('./index.html') || caches.match('./offline.html'))
        );
        return;
    }

    // Strategy 2: Stale-While-Revalidate for local assets (app.js, manifest, CSS)
    // Serve from cache immediately for speed, but fetch latest in background for next time
    const isLocalAsset = STATIC_ASSETS.some(asset => event.request.url.includes(asset.replace('./', '')));

    if (isLocalAsset || url.origin === location.origin) {
        event.respondWith(
            caches.match(event.request).then(cachedResponse => {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200) {
                        const copy = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
                    }
                    return networkResponse;
                }).catch(() => {
                    // Fail silently if offline, the cached response (if any) will be used
                });
                return cachedResponse || fetchPromise;
            })
        );
        return;
    }

    // Strategy 3: Cache First for everything else (CDNs, Icons, etc.)
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                // If it's an API request, return mock data for the demo
                if (event.request.url.includes('/api/')) {
                    return handleMockApi(event.request);
                }

                return fetch(event.request)
                    .then(response => {
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        const responseToCache = response.clone();
                        caches.open(DYNAMIC_CACHE).then(cache => {
                            cache.put(event.request, responseToCache);
                        });

                        return response;
                    })
                    .catch(error => {
                        // For API calls, return a JSON offline response
                        if (event.request.url.includes('/api/')) {
                            return new Response(
                                JSON.stringify({
                                    error: 'You are offline',
                                    offline: true
                                }),
                                { headers: { 'Content-Type': 'application/json' } }
                            );
                        }
                        throw error;
                    });
            })
    );
});

// Background Sync
self.addEventListener('sync', event => {
    console.log('[SW] Background Sync:', event.tag);

    if (event.tag === 'sync-parking-data') {
        event.waitUntil(syncParkingData());
    }
});

// Push Notifications
self.addEventListener('push', event => {
    console.log('[SW] Push received:', event);

    let data = {
        title: 'Parking Alert',
        body: 'New notification from SmartPark 2.0',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        vibrate: [200, 100, 200],
        tag: 'parking-alert',
        renotify: true,
        data: {
            url: '/'
        }
    };

    if (event.data) {
        try {
            data = { ...data, ...event.data.json() };
        } catch (e) {
            console.error('Failed to parse push data:', e);
        }
    }

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon,
            badge: data.badge,
            vibrate: data.vibrate,
            tag: data.tag,
            renotify: data.renotify,
            data: data.data,
            actions: [
                {
                    action: 'view',
                    title: 'View Details'
                },
                {
                    action: 'dismiss',
                    title: 'Dismiss'
                }
            ]
        })
    );
});

// Notification Click Handler
self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.action === 'view' || !event.action) {
        const urlToOpen = event.notification.data?.url || '/';

        event.waitUntil(
            clients.matchAll({
                type: 'window',
                includeUncontrolled: true
            })
                .then(windowClients => {
                    // Check if there is already a window/tab open with the target URL
                    for (let client of windowClients) {
                        if (client.url === urlToOpen && 'focus' in client) {
                            return client.focus();
                        }
                    }
                    // If not, open a new window/tab
                    if (clients.openWindow) {
                        return clients.openWindow(urlToOpen);
                    }
                })
        );
    }
});

// Periodic Background Sync (if supported)
self.addEventListener('periodicsync', event => {
    if (event.tag === 'check-parking-status') {
        event.waitUntil(checkParkingStatus());
    }
});

// Mock API Handler for demo purposes
function handleMockApi(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    let responseData = { success: true, mock: true, timestamp: new Date().toISOString() };

    if (path.includes('/api/parking/status')) {
        responseData = {
            ...responseData,
            status: 'online',
            totalBays: 8,
            violations: []
        };
    } else if (path.includes('/api/parking/sync')) {
        responseData = {
            ...responseData,
            message: 'Data successfully synced with mock server'
        };
    }

    return new Response(JSON.stringify(responseData), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
    });
}


// Helper function to sync parking data
async function syncParkingData() {
    console.log('[SW] Syncing parking data...');

    try {
        const cache = await caches.open(DYNAMIC_CACHE);
        const requests = await cache.keys();

        for (let request of requests) {
            if (request.url.includes('/api/parking/offline')) {
                const response = await cache.match(request);
                const data = await response.json();

                // Send to server when online
                await fetch('/api/parking/sync', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                // Remove from cache after successful sync
                await cache.delete(request);
            }
        }

        console.log('[SW] Parking data synced successfully');
    } catch (error) {
        console.error('[SW] Failed to sync parking data:', error);
        throw error;
    }
}

// Helper function to sync violations
async function syncViolations() {
    console.log('[SW] Syncing violations...');

    try {
        const cache = await caches.open(DYNAMIC_CACHE);
        const requests = await cache.keys();

        for (let request of requests) {
            if (request.url.includes('/api/parking/violations')) {
                const response = await cache.match(request);
                const data = await response.json();

                // Send to server when online
                await fetch('/api/parking/violations/sync', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                // Remove from cache after successful sync
                await cache.delete(request);
            }
        }

        console.log('[SW] Violations synced successfully');
    } catch (error) {
        console.error('[SW] Failed to sync violations:', error);
        throw error;
    }
}

// Helper function to check parking status in background
async function checkParkingStatus() {
    console.log('[SW] Checking parking status...');

    try {
        const response = await fetch('/api/parking/status');
        const data = await response.json();

        // Check for low compliance zones
        const lowComplianceZones = data.lowComplianceZones || [];

        if (lowComplianceZones.length > 0) {
            // Show notification for low compliance
            await self.registration.showNotification('Low Compliance Alert', {
                body: `${lowComplianceZones.length} zone(s) have low compliance rate`,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/icon-72x72.png',
                tag: 'compliance-alert',
                data: {
                    url: '/'
                }
            });
        }

        // Cache the status for offline use
        const cache = await caches.open(DYNAMIC_CACHE);
        await cache.put('/api/parking/status', new Response(JSON.stringify(data)));
    } catch (error) {
        console.error('[SW] Failed to check parking status:', error);
    }
}

// Message handler for communication with the page
self.addEventListener('message', event => {
    console.log('[SW] Message received:', event.data);

    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CACHE_URL') {
        event.waitUntil(
            caches.open(DYNAMIC_CACHE)
                .then(cache => cache.add(event.data.url))
        );
    }
});