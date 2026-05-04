# Firestore Security Rules
# GPS/Geofencing Parking System

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    // Check if user is authenticated
    function isAuthenticated() {
      return request.auth != null;
    }

    // Check if user is admin (configure based on your auth system)
    function isAdmin() {
      return isAuthenticated() && 
             request.auth.token.admin == true;
    }

    // Check if document belongs to the requesting user
    function isOwner(userId) {
      return isAuthenticated() && 
             request.auth.uid == userId;
    }

    // ============================================================
    // ZONES COLLECTION
    // ============================================================
    // Defines geofenced parking zones with center coordinates, radius, and total lots
    // Only admins can create/update zones. Everyone can read zones.
    
    match /zones/{zoneId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // ============================================================
    // PAYMENT SESSIONS COLLECTION
    // ============================================================
    // Stores active and completed payment sessions
    // Users can create their own sessions and read their own sessions
    // Admins can read all sessions
    
    match /paymentSessions/{sessionId} {
      allow read: if isOwner(resource.data.userId) || isAdmin();
      allow create: if isAuthenticated() && 
                       request.resource.data.userId == request.auth.uid;
      allow update: if isOwner(resource.data.userId) || isAdmin();
      allow delete: if isAdmin();
    }

    // ============================================================
    // COMPLIANCE SNAPSHOTS COLLECTION
    // ============================================================
    // Stores periodic compliance rate calculations for each zone
    // Read-only for all users, write-only for system (admin)
    
    match /complianceSnapshots/{snapshotId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // ============================================================
    // DAILY SUMMARY COLLECTION
    // ============================================================
    // Stores daily aggregated statistics (sessions, fees, etc.)
    // Read-only for all users, write-only for system (admin)
    
    match /dailySummary/{date} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // ============================================================
    // INDEXING REQUIREMENTS
    // ============================================================
    // Create the following indexes in Firestore for optimal performance:
    //
    // paymentSessions:
    //   - status (ascending)
    //   - zoneId (ascending)
    //   - startTime (ascending)
    //
    // complianceSnapshots:
    //   - timestamp (descending)
    //   - zoneId (ascending)
    //
    // dailySummary:
    //   - date (ascending)
  }
}
