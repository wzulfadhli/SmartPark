// ============================================================
// FIREBASE CONFIGURATION - GPS/Geofencing Parking System
// ============================================================
// This is a NEW Firebase project for the geofencing-based system.
// Replace the values below with your own Firebase project config.
// Go to: https://console.firebase.google.com → Your Project →
// Project Settings → Your Apps → Firebase SDK snippet → Config
// ============================================================

// Firebase configuration - replace with your new project credentials
const FIREBASE_CONFIG = {
    apiKey: process.env.FIREBASE_API_KEY || "YOUR_API_KEY",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "your-project.firebaseapp.com",
    projectId: process.env.FIREBASE_PROJECT_ID || "your-project-id",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "your-project.appspot.com",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "123456789",
    appId: process.env.FIREBASE_APP_ID || "1:123456789:web:abcdef123456"
};

// ============================================================
// FIRESTORE DATA STRUCTURE
// ============================================================
/*
The new Firestore structure for GPS/geofencing-based parking:

1. Collection: "zones"
   - Document ID: zoneId (e.g., "zone_ss15_4")
   - Fields:
     * name: string (e.g., "Jalan SS15/4")
     * center: { lat: number, lng: number }
     * radius: number (in meters)
     * totalLots: number (e.g., 200)
     * createdAt: timestamp
     * updatedAt: timestamp

2. Collection: "paymentSessions"
   - Document ID: sessionId (auto-generated or custom)
   - Fields:
     * sessionId: string (unique identifier)
     * zoneId: string (reference to zones collection)
     * vehicleId: string (vehicle identifier)
     * userId: string (optional user identifier)
     * startTime: timestamp
     * endTime: timestamp
     * location: { lat: number, lng: number }
     * status: string ("active", "completed", "cancelled")
     * createdAt: timestamp
     * updatedAt: timestamp

3. Collection: "complianceSnapshots"
   - Document ID: auto-generated
   - Fields:
     * zoneId: string
     * timestamp: timestamp
     * activeSessions: number
     * totalLots: number
     * complianceRate: number (0-100)
     * statusColor: string ("green", "orange", "red")
     * createdAt: timestamp

4. Collection: "dailySummary"
   - Document ID: date (YYYY-MM-DD format)
   - Fields:
     * date: string (YYYY-MM-DD)
     * totalSessions: number
     * totalViolations: number
     * feesCollected: number
     * avgComplianceRate: number
     * createdAt: timestamp
     * updatedAt: timestamp
*/

// ============================================================
// COMPLIANCE THRESHOLDS (Configurable)
// ============================================================
const COMPLIANCE_THRESHOLDS = {
    HIGH: 80,    // >= 80% = Green
    MEDIUM: 50,  // 50-79% = Orange
    LOW: 0       // < 50% = Red
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        FIREBASE_CONFIG,
        COMPLIANCE_THRESHOLDS
    };
}
