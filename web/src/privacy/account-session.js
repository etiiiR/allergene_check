import { lockVaultSession } from "./vault-session.js";

// Keep the in-memory diary locked before leaving a successfully logged-out
// page, including when the browser restores that page from its back/forward
// cache. A failed sign-out keeps the current session usable for a retry.
export async function logoutCurrentDevice() {
  let response;
  try {
    response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Diary-Request": "1" },
    });
  } catch {
    throw new Error(
      "Dieses Gerät konnte nicht abgemeldet werden. Prüfe die Verbindung und versuche es erneut.",
    );
  }

  if (!response.ok) {
    throw new Error("Dieses Gerät konnte nicht abgemeldet werden.");
  }
  lockVaultSession();
}
