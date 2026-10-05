# Privacy and end-to-end encryption plan

Status: pseudonym entry is implemented; encryption is not implemented. This is a staged security plan, not a claim that the current app is private or production-ready.

## What the current code does

- Onboarding and Profile now suggest an editable pseudonym. The pseudonym is only a display name: the current server still stores it in plaintext.
- SurrealDB stores every diary entity as plaintext JSON in its `payload` field (`diary_store.go`). This includes recipes, exact meal/check-in times, symptoms, stool notes, stress/health observations, and cycle information.
- `GET /api/diary` returns the complete diary and `/api/export` returns a plaintext JSON export (`diary_routes.go`). CRUD and health-import endpoints also receive and return plaintext.
- Gonertia receives the complete diary as page props (`web.go`), so encrypting just the database column would not provide end-to-end encryption.
- Pattern analysis sends symptom/check-in data, meal times, ingredient IDs, flags, cycle context, stools, and stress observations to the Python service (`analysis_client.go`). Ingredient analysis also forwards submitted text. The recipe crawler receives the submitted URL.
- The native iOS HealthKit bridge currently submits imported records to the same plaintext health-import endpoint.
- Same-origin checks, loopback host checks, and several response headers exist. They are useful safeguards, but they are not user authentication or encryption. The app is documented as a single-person local app with no accounts.

## Privacy goals and limits

The target is to keep diary contents unreadable to the database and application server while stored or backed up, with encryption and decryption performed on the trusted user's device. The server may still observe that a pseudonymous vault exists, request timing, ciphertext size, and the user's network address. A pseudonym is not anonymity: distinctive recipes, dates, and other outside information can identify someone.

Browser-based encryption cannot protect against a compromised device, keylogger, malicious browser extension, XSS, or a server that deliberately ships modified JavaScript to steal an unlocked key. It also does not provide account authorization, safe remote access, availability, or protection for old plaintext backups. HTTPS and a clear threat model remain necessary. The UI and documentation must not promise more than this.

## Intended design

1. Generate a random 256-bit data-encryption key on-device. Encrypt the complete diary as one versioned vault using Web Crypto AES-GCM with a fresh random nonce for every encryption. Keep identifiers, profile, recipes, timestamps, symptoms, notes, imported health data, and analysis inputs inside that encrypted payload.
2. Protect the data key with a user passphrase using versioned PBKDF2-HMAC-SHA-256 at 600,000 iterations in the browser's built-in Web Crypto API for the first vault format. OWASP currently recommends this PBKDF2 work factor. Argon2id is a stronger memory-hard candidate for a later format if a maintained browser implementation can be pinned, reviewed, and tested on supported iPhones. Never silently change KDF parameters; benchmark unlock time and bound server-supplied parameters to prevent denial of service.
3. Offer a separate high-entropy recovery key that can also wrap the data key. Show it once, require confirmation that it was saved, and explain clearly that losing both passphrase and recovery key means permanent data loss. Passphrase changes should re-wrap the data key; planned key rotation should re-encrypt the vault.
4. Store one opaque, revisioned ciphertext envelope server-side rather than separate readable rows. Keep only unavoidable transport metadata outside it. Use revision/ETag checks so two tabs cannot silently overwrite one another; resolve stale updates on the client.
5. Decrypt in the browser only after unlock. Keep keys out of URLs, logs, Inertia props, localStorage, and analytics. Lock explicitly and after inactivity; store only encrypted offline queues. JavaScript cannot guarantee secure memory erasure, so describe that limitation.
6. Run pattern analysis, ingredient normalization, report generation, and any BERT inference on-device. The current Python analysis path must not receive decrypted diary data. The browser recipe importer should fetch directly where the source permits it; any proxy fallback must disclose that the URL/content is sent to that service. The iOS HealthKit bridge must encrypt records before network transfer.
7. Replace plaintext `/api/diary`, `/api/export`, CRUD, health, and analysis paths with an authenticated opaque-vault API. Do not leave a hidden plaintext endpoint available after migration. Plaintext export, if retained, must be explicitly created after local decryption and clearly warned; the default backup should remain encrypted.

## Safe migration and release order

1. Agree and test the key/recovery experience, including passphrase loss, account/device changes, and lock behavior.
2. Build and test the client crypto module against known test vectors, wrong keys, modified ciphertext, nonce handling, and full diary round-trips. Select and pin a maintained KDF package only after dependency and iOS-browser performance review.
3. Add a server endpoint that stores and returns only an opaque encrypted vault, with revision conflicts and access control. Keep it unavailable for public deployment until authentication and HTTPS are in place.
4. Move all frontend data flows to the unlocked client vault, then move pattern, recipe-text, report, and HealthKit processing off the plaintext server path. Verify by placing unique sentinel phrases in each data type and searching HTTP logs, application logs, DB records, ML requests, Inertia props, and backups.
5. Migrate existing records by reading the old database on-device, encrypting the complete diary, writing the new vault, reading it back, and verifying decryption before declaring success. Do not automatically delete old tables, volume snapshots, or exports: they may be the only recoverable copy. Purging historical plaintext requires a separate retention and backup decision.
6. Add security review and release gates: authentication/authorization, HTTPS, CSP/XSS hardening, dependency review, safe error/log handling, encrypted backups, recovery drills, concurrency tests, mobile HealthKit tests, and a user-facing privacy explanation. Keep the app marked local-only until these gates pass.

## Current verification

- The five-star symptom component preserves the existing 0–10 analysis/API data while displaying a 0–5 rating.
- New profiles receive an editable pseudonym suggestion; existing names are not silently changed.
- A standalone version-1 browser vault primitive now encrypts a JSON diary, wraps a random non-extractable data key with both a passphrase and a recovery key, and rejects wrong keys or modified ciphertext. It is covered by unit tests but is not connected to the app's storage or routes.
- Frontend unit tests and production asset build pass. Go tests pass. Browser-level tests could not be run in this environment because Docker is unavailable and the isolated test server is not running.
- The app still stores and transmits diary data in plaintext. No vault API, migration, unlock/recovery screens, or server-side plaintext removal has been implemented yet.

## References

- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [OWASP Key Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html)
- [RFC 9106: Argon2 Memory-Hard Function](https://www.rfc-editor.org/rfc/rfc9106)
- [MDN: Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Cross Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
