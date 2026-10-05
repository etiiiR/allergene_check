import { api } from "../lib";

export const nativeHealthAvailable = () =>
  window.BauchHealth?.platform === "ios" &&
  typeof window.BauchHealth?.read === "function";

// HealthKit access occurs only inside our native, origin-restricted WKWebView.
// The browser never fabricates an authorization prompt or a connected status.
export async function syncAppleHealth() {
  if (!nativeHealthAvailable())
    throw new Error(
      "Die direkte Freigabe ist nur in der iOS-App verfügbar, nicht in Safari oder einer installierten Web-App.",
    );
  const result = await window.BauchHealth.read();
  if (!Array.isArray(result?.records))
    throw new Error(
      "Die iOS-App hat keine gültigen Gesundheitsdaten geliefert.",
    );
  if (!result.records.length) return { imported: 0, updated: 0, empty: true };
  // Raw HRV/pulse are context only, never a made-up stress score.
  const records = result.records.map(
    ({ external_id, metric, value, unit, observed_at, observed_until }) => ({
      source: "apple_healthkit",
      external_id,
      metric,
      value,
      unit,
      observed_at,
      observed_until,
    }),
  );
  return api("/health/import", {
    method: "POST",
    body: JSON.stringify({ source: "apple_healthkit", records }),
  });
}
