# SmartPark 2.0 — Firestore Production Schema
## GPS / Geofencing Parking Compliance System

---

## Architecture Overview

```
[Payment System DB]  ──(read-only)──→  external_payment_sessions
                                              ↓
                                     Laravel Scheduler (30s)
                                     PHP geofence check
                                              ↓
                                       parking_sessions
                                       (zone_id + is_compliant)
                                              ↓
                                          Dashboard
```

In **demo mode**, `external_payment_sessions` is seeded from `dummy-data.js`.  
In **production**, the Laravel scheduler writes directly to `parking_sessions` after polling the payment provider's API.

---

## Collections

### 1. `zones`
Geofenced parking zones. Managed by admins only.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string (doc ID) | e.g. `zone_ss15_4` |
| `name` | string | Human-readable, e.g. `Jalan SS15/4` |
| `center` | map `{lat, lng}` | Used for circle zones |
| `radius` | number | Meters. Circle zones only |
| `line` | array of `{lat, lng}` | Road-line zones (polyline + buffer) |
| `bufferMeters` | number | Half-width of road buffer (default 20) |
| `totalLots` | number | Capacity |
| `isActive` | boolean | Soft-disable a zone without deletion |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

**Indexes:** none required (full collection reads only)

---

### 2. `external_payment_sessions`
**Read-only mirror of the payment provider's DB.**  
In production, this is written by a one-way sync adapter (never touched by SmartPark logic).  
In demo, seeded by `firebase-seed.js`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string (doc ID) | Payment provider's primary key |
| `vehicle_id` | string | Plate or token |
| `lat` | number | GPS at time of payment |
| `lng` | number | GPS at time of payment |
| `start_time` | timestamp | |
| `end_time` | timestamp | `start_time + duration` |
| `duration_minutes` | number | |
| `status` | string | `active` / `completed` / `upcoming` / `cancelled` |
| `raw_payload` | map | Full original JSON from provider (for debugging) |
| `received_at` | timestamp | When we first saw this record |
| `updated_at` | timestamp | Last change in provider's system |

**Indexes:**
```
status (ASC) + updated_at (ASC)   ← scheduler polls: WHERE status='active' ORDER BY updated_at
status (ASC) + start_time (ASC)
```

---

### 3. `parking_sessions`
**The core processed table. 1:1 equivalent of your SQL schema.**  
Written exclusively by the Laravel scheduler after geofence resolution.

| Field | Type | SQL equivalent | Notes |
|-------|------|---------------|-------|
| `id` | string (doc ID) | `id` | Auto-generated Firestore ID |
| `external_session_id` | string | `external_session_id` | Payment provider PK — used for dedup |
| `vehicle_id` | string | `vehicle_id` | |
| `lat` | number | `lat` | GPS coordinates |
| `lng` | number | `lng` | |
| `zone_id` | string \| null | `zone_id` | `null` = outside all zones |
| `is_compliant` | boolean | `is_compliant` | `true` if zone_id is not null AND status=active AND within time window |
| `start_time` | timestamp | `start_time` | |
| `end_time` | timestamp | `end_time` | |
| `duration_minutes` | number | — | Derived, stored for convenience |
| `status` | string | `status` | `active` / `completed` / `upcoming` / `cancelled` |
| `synced_at` | timestamp | `synced_at` | Last time scheduler touched this record |
| `created_at` | timestamp | — | First time written to Firestore |

**Indexes:**
```
status (ASC)                                 ← list active sessions
status (ASC) + zone_id (ASC)                 ← zone compliance calculation
status (ASC) + start_time (ASC)              ← time-window queries
zone_id (ASC) + is_compliant (ASC)           ← per-zone compliance rate
external_session_id (ASC)                    ← deduplication check (UNIQUE)
synced_at (ASC)                              ← find stale records
```

---

### 4. `compliance_snapshots`
Periodic point-in-time compliance snapshots. Written by scheduler after each sync run.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string (doc ID) | Auto-generated |
| `zone_id` | string | |
| `zone_name` | string | Denormalized for query convenience |
| `timestamp` | timestamp | When snapshot was taken |
| `active_sessions` | number | Sessions inside zone at snapshot time |
| `total_lots` | number | Zone capacity (denormalized) |
| `compliance_rate` | number | `(active_sessions / total_lots) * 100`, clamped 0–100 |
| `status_color` | string | `green` / `orange` / `red` |
| `outside_zone_count` | number | Active payers not inside any zone at this time |
| `created_at` | timestamp | |

**Indexes:**
```
zone_id (ASC) + timestamp (DESC)    ← per-zone history chart
timestamp (DESC)                    ← latest snapshot across all zones
```

---

### 5. `sync_runs`
Audit log of every Laravel scheduler execution. One document per run.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string (doc ID) | Auto-generated |
| `started_at` | timestamp | |
| `completed_at` | timestamp | Null until run finishes |
| `duration_ms` | number | Wall clock time of the run |
| `sessions_polled` | number | How many records fetched from payment provider |
| `sessions_created` | number | Net-new parking_sessions written |
| `sessions_updated` | number | Existing records updated (status change, etc.) |
| `sessions_skipped` | number | Already up-to-date (dedup hit) |
| `error_count` | number | Failed geofence lookups or write errors |
| `errors` | array of string | Error messages (capped at 10) |
| `trigger` | string | `scheduler` / `manual` / `webhook` |

**Indexes:**
```
started_at (DESC)    ← most recent runs first
trigger (ASC) + started_at (DESC)
```

---

### 6. `daily_summary`
Aggregated daily stats. Doc ID = `YYYY-MM-DD`.

| Field | Type | Notes |
|-------|------|-------|
| `date` | string | `YYYY-MM-DD` |
| `total_sessions` | number | All sessions that day (any status) |
| `active_peak` | number | Max concurrent active sessions in the day |
| `compliance_avg` | number | Average compliance rate across all zones |
| `outside_zone_count` | number | Sessions that never matched a zone |
| `sync_run_count` | number | How many scheduler runs happened |
| `created_at` | timestamp | |
| `updated_at` | timestamp | Last incremental update |

---

## Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuthenticated() {
      return request.auth != null;
    }
    function isAdmin() {
      return isAuthenticated() && request.auth.token.admin == true;
    }
    function isService() {
      // Laravel scheduler uses a service account
      return isAuthenticated() && request.auth.token.service == true;
    }

    // Zones: public read, admin write
    match /zones/{zoneId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // External sessions: service writes (sync adapter), admin read-only in console
    match /external_payment_sessions/{sessionId} {
      allow read: if isAdmin();
      allow write: if isService() || isAdmin();
    }

    // Parking sessions: service writes, authenticated users can read their own
    match /parking_sessions/{sessionId} {
      allow read: if isAdmin() || (isAuthenticated() && resource.data.vehicle_id == request.auth.token.vehicle_id);
      allow create, update: if isService() || isAdmin();
      allow delete: if isAdmin();
    }

    // Compliance snapshots: public read, service write
    match /compliance_snapshots/{snapshotId} {
      allow read: if true;
      allow write: if isService() || isAdmin();
    }

    // Sync runs: admin/service only
    match /sync_runs/{runId} {
      allow read: if isAdmin();
      allow write: if isService() || isAdmin();
    }

    // Daily summary: public read, service write
    match /daily_summary/{date} {
      allow read: if true;
      allow write: if isService() || isAdmin();
    }
  }
}
```

---

## Laravel Scheduler Logic (Pseudo-PHP)

```php
// ParkingSessionSyncJob.php
// Runs every 30 seconds via: $schedule->job(new ParkingSessionSyncJob)->everyThirtySeconds();

public function handle()
{
    $runId = Firestore::collection('sync_runs')->newDocument()->id();
    $run = ['started_at' => now(), 'trigger' => 'scheduler', ...];

    // 1. Poll payment provider for new/updated active sessions
    $externalSessions = PaymentProviderDB::query()
        ->where('status', 'active')
        ->where('updated_at', '>', $this->lastSyncAt())
        ->get();

    foreach ($externalSessions as $ext) {
        // 2. Deduplication check
        $existing = Firestore::collection('parking_sessions')
            ->where('external_session_id', '=', $ext->id)
            ->limit(1)->get();

        // 3. PHP geofence check
        $zoneId = GeofenceService::findZone($ext->lat, $ext->lng);
        $isCompliant = $zoneId !== null
            && $ext->status === 'active'
            && now()->between($ext->start_time, $ext->end_time);

        // 4. Write to parking_sessions
        $data = [
            'external_session_id' => $ext->id,
            'vehicle_id'          => $ext->vehicle_id,
            'lat'                 => $ext->lat,
            'lng'                 => $ext->lng,
            'zone_id'             => $zoneId,
            'is_compliant'        => $isCompliant,
            'start_time'          => $ext->start_time,
            'end_time'            => $ext->end_time,
            'duration_minutes'    => $ext->duration_minutes,
            'status'              => $ext->status,
            'synced_at'           => now(),
        ];

        if ($existing->isEmpty()) {
            Firestore::collection('parking_sessions')->add($data + ['created_at' => now()]);
        } else {
            $existing->first()->reference()->update($data);
        }
    }

    // 5. Write compliance snapshots
    ComplianceSnapshotService::takeSnapshot();

    // 6. Close sync run
    Firestore::collection('sync_runs')->document($runId)->update(['completed_at' => now(), ...]);
}
```

---

## Demo → Production Migration Checklist

| Step | Demo | Production |
|------|------|-----------|
| Zone data | `dummy-data.js` / seeded via `firebase-seed.js` | Admin UI or migration script |
| External sessions source | `firebase-seed.js` writes to `external_payment_sessions` | Laravel sync adapter reads real payment DB |
| Geofence check | Client-side JS (`geofencing-utils.js`) | PHP `GeofenceService` (same algorithm) |
| `parking_sessions` writer | Client-side `app.js` (demo only) | Laravel scheduler exclusively |
| Auth | None (demo) | Firebase Auth + service account for Laravel |
| Security rules | Open (demo) | Lock down with `isService()` token check |
| Firestore indexes | Create via Firebase console | Deploy with `firestore.indexes.json` |

