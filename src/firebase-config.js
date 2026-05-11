const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyDEyDj-bW8rRgaivvfNPVub8AfWMDpbWdY",
    authDomain:        "gpark-9eed8.firebaseapp.com",
    projectId:         "gpark-9eed8",
    storageBucket:     "gpark-9eed8.firebasestorage.app",
    messagingSenderId: "517710435374",
    appId:             "1:517710435374:web:7ca16215d5ab4422243bbf"
};

const COMPLIANCE_THRESHOLDS = {
    HIGH:   80,
    MEDIUM: 50,
    LOW:    0,
};

const COLLECTIONS = {
    ZONES:                     'zones',
    EXTERNAL_PAYMENT_SESSIONS: 'external_payment_sessions',
    PARKING_SESSIONS:          'parking_sessions',
    COMPLIANCE_SNAPSHOTS:      'compliance_snapshots',
    SYNC_RUNS:                 'sync_runs',
    DAILY_SUMMARY:             'daily_summary',
};

// ============================================================
// COLLECTION SCHEMAS (documentation + runtime field lists)
// ============================================================
 
/*
──────────────────────────────────────────────────────
 1. zones/{zoneId}
──────────────────────────────────────────────────────
  name             string      "Jalan SS15/4"
  center           map         { lat, lng }           circle zones only
  radius           number      meters                 circle zones only
  line             array<map>  [{lat,lng},…]           road-line zones only
  bufferMeters     number      half-width (default 20) road-line zones only
  totalLots        number      parking capacity
  isActive         boolean     soft-disable
  createdAt        timestamp
  updatedAt        timestamp
 
──────────────────────────────────────────────────────
 2. external_payment_sessions/{id}
    Read-only mirror of payment provider data.
    Laravel scheduler reads this; never writes from dashboard.
──────────────────────────────────────────────────────
  vehicle_id       string      plate or token
  lat              number      GPS at payment time
  lng              number
  start_time       timestamp
  end_time         timestamp
  duration_minutes number
  status           string      active|completed|upcoming|cancelled
  raw_payload      map         full provider JSON (for debugging)
  received_at      timestamp   first time we saw this record
  updated_at       timestamp   last change in provider system
 
──────────────────────────────────────────────────────
 3. parking_sessions/{id}                    ← YOUR LOCAL TABLE
    Written exclusively by Laravel scheduler after geofence check.
    1:1 equivalent of your SQL parking_sessions table.
──────────────────────────────────────────────────────
  external_session_id  string      provider PK — for deduplication   ← UNIQUE INDEX
  vehicle_id           string
  lat                  number
  lng                  number
  zone_id              string|null  null = outside all zones
  is_compliant         boolean      zone_id != null AND active AND in time window
  start_time           timestamp
  end_time             timestamp
  duration_minutes     number
  status               string      active|completed|upcoming|cancelled
  synced_at            timestamp   last scheduler touch
  created_at           timestamp   first write
 
──────────────────────────────────────────────────────
 4. compliance_snapshots/{id}
    Periodic point-in-time snapshots per zone.
──────────────────────────────────────────────────────
  zone_id              string
  zone_name            string      denormalised
  timestamp            timestamp
  active_sessions      number      in-zone + in-window at snapshot time
  total_lots           number      denormalised
  compliance_rate      number      0–100, 1dp
  status_color         string      green|orange|red
  outside_zone_count   number      active payers not in any zone
  created_at           timestamp
 
──────────────────────────────────────────────────────
 5. sync_runs/{id}
    Audit log of every Laravel scheduler execution.
──────────────────────────────────────────────────────
  started_at       timestamp
  completed_at     timestamp   null until done
  duration_ms      number
  sessions_polled  number
  sessions_created number
  sessions_updated number
  sessions_skipped number      dedup hits
  error_count      number
  errors           array<string>  capped at 10
  trigger          string      scheduler|manual|webhook|seed
 
──────────────────────────────────────────────────────
 6. daily_summary/{YYYY-MM-DD}
──────────────────────────────────────────────────────
  date             string      "2025-01-15"
  total_sessions   number
  active_peak      number      max concurrent active sessions
  compliance_avg   number
  outside_zone_count number
  sync_run_count   number
  created_at       timestamp
  updated_at       timestamp
*/
 
// ============================================================
// REQUIRED FIRESTORE INDEXES (create in Firebase console or
// deploy via firestore.indexes.json)
// ============================================================
/*
external_payment_sessions:
  status ASC + updated_at ASC
  status ASC + start_time ASC
 
parking_sessions:
  status ASC
  status ASC + zone_id ASC
  status ASC + start_time ASC
  zone_id ASC + is_compliant ASC
  external_session_id ASC          ← unique, for dedup
  synced_at ASC
 
compliance_snapshots:
  zone_id ASC + timestamp DESC
  timestamp DESC
 
sync_runs:
  started_at DESC
  trigger ASC + started_at DESC
*/
 
// ============================================================
// firestore.indexes.json  (place at project root, deploy with
// `firebase deploy --only firestore:indexes`)
// ============================================================
const FIRESTORE_INDEXES = {
    indexes: [
        // external_payment_sessions
        { collectionGroup: 'external_payment_sessions', queryScope: 'COLLECTION',
          fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'updated_at', order: 'ASCENDING' }] },
        { collectionGroup: 'external_payment_sessions', queryScope: 'COLLECTION',
          fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'start_time', order: 'ASCENDING' }] },
 
        // parking_sessions
        { collectionGroup: 'parking_sessions', queryScope: 'COLLECTION',
          fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'zone_id', order: 'ASCENDING' }] },
        { collectionGroup: 'parking_sessions', queryScope: 'COLLECTION',
          fields: [{ fieldPath: 'status', order: 'ASCENDING' }, { fieldPath: 'start_time', order: 'ASCENDING' }] },
        { collectionGroup: 'parking_sessions', queryScope: 'COLLECTION',
          fields: [{ fieldPath: 'zone_id', order: 'ASCENDING' }, { fieldPath: 'is_compliant', order: 'ASCENDING' }] },
        { collectionGroup: 'parking_sessions', queryScope: 'COLLECTION',
          fields: [{ fieldPath: 'synced_at', order: 'ASCENDING' }] },
 
        // compliance_snapshots
        { collectionGroup: 'compliance_snapshots', queryScope: 'COLLECTION',
          fields: [{ fieldPath: 'zone_id', order: 'ASCENDING' }, { fieldPath: 'timestamp', order: 'DESCENDING' }] },
        { collectionGroup: 'compliance_snapshots', queryScope: 'COLLECTION',
          fields: [{ fieldPath: 'timestamp', order: 'DESCENDING' }] },
 
        // sync_runs
        { collectionGroup: 'sync_runs', queryScope: 'COLLECTION',
          fields: [{ fieldPath: 'trigger', order: 'ASCENDING' }, { fieldPath: 'started_at', order: 'DESCENDING' }] },
    ],
    fieldOverrides: [],
};
 
// Export for Node.js (seed scripts, tests)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FIREBASE_CONFIG, COMPLIANCE_THRESHOLDS, COLLECTIONS, FIRESTORE_INDEXES };
}
 