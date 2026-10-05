# Mobile health bridge

A first native iOS implementation is now prepared in [`mobile/ios`](../mobile/ios/README.md).
It requests HealthKit access directly and reads raw pulse/HRV measurements into the same contract,
without selecting a JSON file. It still needs an iOS SDK build, signing and device testing.
Android/Samsung are not implemented yet.

The web app cannot read a watch or ring directly. A small native iOS or Android companion, a vendor export, or a trusted automation reads health data after the user grants permission and sends the provider-neutral JSON contract to:

```text
POST http://localhost:3000/api/health/import
Content-Type: application/json
X-Diary-Request: 1
```

The iOS side should use [HealthKit](https://developer.apple.com/documentation/healthkit) on iPhone/Apple Watch. HealthKit requires the native app to enable the capability, check device availability, and request read permission before querying samples. The Android side should use [Health Connect](https://developer.android.com/health-and-fitness/health-connect); its native app requests the relevant read permissions and reads records while respecting the user's access and history limits.

Neither platform guarantees a generic stress field for every device or provider. A vendor adapter should send an explicit `stress_score` only when the source itself supplies a stress score and normalize it to `0..10`. HRV, heart rate, resting heart rate, sleep and readiness values can be sent as raw context, but the app deliberately never infers stress from those values.

## Contract

Use the example file in this folder as a starting point. The top-level `source` is selected in the Profile page, and every record must contain:

| Field | Meaning |
| --- | --- |
| `source` | `apple_healthkit`, `android_health_connect`, `oura`, `ring`, `watch`, or `generic` |
| `external_id` | Stable vendor sample ID; enables safe re-import/upsert |
| `metric` | `stress_score`, `hrv`, `heart_rate`, `resting_heart_rate`, `sleep_score`, or `readiness_score` |
| `value` / `unit` | Original vendor value and unit |
| `normalized_stress` | Optional explicit `0..10` provider stress score; required for `stress_score` |
| `observed_at` / `observed_until` | RFC3339 timestamp and optional interval end |

Example:

```json
{
  "source": "apple_healthkit",
  "records": [
    {
      "external_id": "vendor-sample-123",
      "metric": "stress_score",
      "value": 72,
      "unit": "percent",
      "normalized_stress": 7.2,
      "observed_at": "2026-09-21T09:00:00Z"
    }
  ]
}
```

The API updates an existing record when `source + external_id` is repeated and creates a new record when the vendor has no stable ID. Imported records are stored locally in SurrealDB and become visible in the pattern analysis under “Stress & Health-Daten”. Only normalized scores within six hours of a symptom check-in, or inside an imported interval, are used as an exploratory analysis covariate.

## Native adapter outline

The native bridge owns permission prompts and vendor-specific mapping. Its last step is simply an HTTP `POST` of the contract above. Do not put HealthKit, Health Connect, ring credentials, or long-lived vendor tokens in the Go web process. For a phone-to-desktop setup, use an authenticated HTTPS endpoint or a secure local pairing mechanism before exposing the server beyond loopback.

For an Oura, Samsung, Garmin, Whoop, or other ring/watch adapter, map the vendor's own stress/readiness score explicitly and preserve the original value/unit. If the vendor exposes only HRV or pulse, import it as the corresponding raw metric and leave `normalized_stress` absent.
