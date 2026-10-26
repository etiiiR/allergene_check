import assert from "node:assert/strict";
import test from "node:test";
import { generateVaultPassphrase } from "../src/privacy/passphrase-generator.js";

test("generates a 32-character URL-safe passphrase from 24 secure random bytes", () => {
  let requestedLength = 0;
  const passphrase = generateVaultPassphrase({
    getRandomValues(bytes) {
      requestedLength = bytes.length;
      bytes.forEach((_, index) => { bytes[index] = index; });
      return bytes;
    },
  });
  assert.equal(requestedLength, 24);
  assert.match(passphrase, /^[A-Za-z0-9_-]{32}$/u);
});

test("fails closed when secure random generation is unavailable", () => {
  assert.throws(
    () => generateVaultPassphrase({}),
    /Sichere Passphrase-Erstellung/u,
  );
});
