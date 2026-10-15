import Foundation
import HealthKit

enum HealthReadError: LocalizedError {
    case unavailable, authorization, query
    var errorDescription: String? {
        switch self {
        case .unavailable: return "HealthKit ist auf diesem Gerät nicht verfügbar."
        case .authorization: return "Die HealthKit-Freigabe konnte nicht abgeschlossen werden."
        case .query: return "Die Gesundheitsdaten konnten nicht vollständig gelesen werden. Bitte erneut versuchen."
        }
    }
}

// Read-only, user-initiated snapshots. No network access, stress inference,
// background observers or health writes in this class.
final class HealthKitReader {
    private let store = HKHealthStore()
    private let metrics: [(HKQuantityTypeIdentifier, String, HKUnit, String)] = [
        (.heartRate, "heart_rate", HKUnit.count().unitDivided(by: .minute()), "bpm"),
        (.restingHeartRate, "resting_heart_rate", HKUnit.count().unitDivided(by: .minute()), "bpm"),
        (.heartRateVariabilitySDNN, "hrv", HKUnit.secondUnit(with: .milli), "ms")
    ]

    func readLastWeek(completion: @escaping (Result<[[String: Any]], Error>) -> Void) {
        guard HKHealthStore.isHealthDataAvailable() else { completion(.failure(HealthReadError.unavailable)); return }
        let types = Set(metrics.compactMap { HKObjectType.quantityType(forIdentifier: $0.0) as HKObjectType? })
        store.requestAuthorization(toShare: [], read: types) { completed, error in
            // `completed` does NOT mean every read permission was granted.
            // HealthKit intentionally does not disclose denial of read access.
            guard completed, error == nil else {
                DispatchQueue.main.async { completion(.failure(HealthReadError.authorization)) }; return
            }
            DispatchQueue.main.async { self.query(completion: completion) }
        }
    }

    private func query(completion: @escaping (Result<[[String: Any]], Error>) -> Void) {
        let end = Date(), start = Date().addingTimeInterval(-7 * 24 * 60 * 60)
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let group = DispatchGroup()
        var records: [[String: Any]] = []
        var failed = false
        let formatter = ISO8601DateFormatter()
        for (identifier, metric, unit, unitName) in metrics {
            guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { continue }
            group.enter()
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: 500,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]) { _, samples, error in
                DispatchQueue.main.async {
                    if error != nil { failed = true }
                    for sample in (samples as? [HKQuantitySample]) ?? [] {
                        records.append([
                            "external_id": sample.uuid.uuidString,
                            "metric": metric, "value": sample.quantity.doubleValue(for: unit), "unit": unitName,
                            "observed_at": formatter.string(from: sample.startDate),
                            "observed_until": formatter.string(from: sample.endDate)
                        ])
                    }
                    group.leave()
                }
            }
            store.execute(query)
        }
        group.notify(queue: .main) {
            if failed { completion(.failure(HealthReadError.query)) }
            else { completion(.success(records)) }
        }
    }
}
