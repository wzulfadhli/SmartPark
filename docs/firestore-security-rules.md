# firestore.rules — SmartPark 2.0
# Deploy: firebase deploy --only firestore:rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── Helpers ──────────────────────────────────────────────
    function isAuthenticated() {
      return request.auth != null;
    }
    function isAdmin() {
      // Admins have a custom claim set via Firebase Admin SDK:
      //   admin.auth().setCustomUserClaims(uid, { admin: true })
      return isAuthenticated() && request.auth.token.admin == true;
    }
    function isService() {
      // Laravel scheduler authenticates via a service account.
      // Set the custom claim on that account's token:
      //   admin.auth().setCustomUserClaims(serviceUid, { service: true })
      return isAuthenticated() && request.auth.token.service == true;
    }
    function isOwner(vehicleId) {
      // A driver can read their own sessions if their token has vehicle_id claim.
      return isAuthenticated() && request.auth.token.vehicle_id == vehicleId;
    }

    // ── 1. zones ─────────────────────────────────────────────
    // Public read (map + dashboard need zones unauthenticated).
    // Write restricted to admins.
    match /zones/{zoneId} {
      allow read:  if true;
      allow write: if isAdmin();
    }

    // ── 2. external_payment_sessions ─────────────────────────
    // Written by the payment system sync adapter (service account).
    // Never exposed to end-users — admin visibility only.
    match /external_payment_sessions/{sessionId} {
      allow read:   if isAdmin();
      allow create: if isService() || isAdmin();
      allow update: if isService() || isAdmin();
      allow delete: if isAdmin();
    }

    // ── 3. parking_sessions ──────────────────────────────────
    // Written exclusively by Laravel scheduler (service account).
    // Drivers can read their own sessions via vehicle_id claim.
    match /parking_sessions/{sessionId} {
      allow read:   if isAdmin()
                    || isOwner(resource.data.vehicle_id);
      allow create: if isService() || isAdmin();
      allow update: if isService() || isAdmin();
      allow delete: if isAdmin();
    }

    // ── 4. compliance_snapshots ──────────────────────────────
    // Public read (dashboard charts need no auth).
    // Write by service (scheduler) or admin only.
    match /compliance_snapshots/{snapshotId} {
      allow read:  if true;
      allow write: if isService() || isAdmin();
    }

    // ── 5. sync_runs ─────────────────────────────────────────
    // Internal audit log — admin/service only.
    match /sync_runs/{runId} {
      allow read:  if isAdmin();
      allow write: if isService() || isAdmin();
    }

    // ── 6. daily_summary ─────────────────────────────────────
    // Public read for reporting dashboards.
    // Write by service or admin.
    match /daily_summary/{date} {
      allow read:  if true;
      allow write: if isService() || isAdmin();
    }
  }
}
```

## Demo vs Production Rules

In **demo mode** (USE_DUMMY_DATA = true) you don't need real Firebase,
so security rules are irrelevant. When switching to real Firebase:

1. Keep `zones`, `compliance_snapshots`, `daily_summary` as public-read — dashboards are unauthenticated.
2. Lock `external_payment_sessions` to service + admin — this is raw provider data.
3. Lock `parking_sessions` writes to the service account only — the scheduler is the sole writer.
4. Never allow client-side writes to `parking_sessions` from the browser dashboard.

## Service Account Setup (Laravel)

```bash
# 1. Create a service account in Firebase Console
#    IAM & Admin → Service Accounts → Create
#    Role: Cloud Datastore User

# 2. Download the JSON key and store securely
#    Never commit this file to source control

# 3. In Laravel, set the custom claim on the service account UID
#    (run this once via a Firebase Admin PHP SDK script)
$uid = 'your-service-account-uid';
$factory->createAuth()->setCustomUserClaims($uid, ['service' => true]);

# 4. Reference in Laravel .env
FIREBASE_CREDENTIALS=/path/to/serviceAccountKey.json
FIREBASE_PROJECT_ID=your-project-id
```

## Firestore Emulator (Local Development)

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Start emulator (runs on localhost:8080 by default)
firebase emulators:start --only firestore

# Seed demo data
FIRESTORE_EMULATOR_HOST=localhost:8080 \
FIREBASE_PROJECT_ID=demo-smartpark \
node firebase-seed.js --clear
```
