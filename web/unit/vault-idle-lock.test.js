import assert from "node:assert/strict";
import test from "node:test";
import {
  createVaultIdleLock,
  VAULT_IDLE_TIMEOUT_MS,
  VAULT_IDLE_WARNING_MS,
} from "../src/privacy/vault-idle-lock.js";

function makeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  let unlocked = true;
  let lockCount = 0;
  let warningCount = 0;
  let activityCount = 0;
  const idleLock = createVaultIdleLock({
    isUnlocked: () => unlocked,
    lock: () => {
      lockCount += 1;
      unlocked = false;
    },
    timeoutMs: VAULT_IDLE_TIMEOUT_MS,
    onWarning: () => {
      warningCount += 1;
    },
    onActivity: () => {
      activityCount += 1;
    },
    now: () => now,
    setTimer: (callback, delay) => {
      const id = nextId++;
      timers.set(id, { callback, dueAt: now + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    idleLock,
    timers,
    get lockCount() {
      return lockCount;
    },
    get warningCount() {
      return warningCount;
    },
    get activityCount() {
      return activityCount;
    },
    setNow(value) {
      now = value;
    },
    setUnlocked(value) {
      unlocked = value;
    },
  };
}

test("warns once before auto-lock and interaction clears the warning window", () => {
  const clock = makeClock();
  clock.idleLock.activity();
  assert.equal(clock.activityCount, 1);
  assert.equal(clock.warningCount, 0);
  assert.equal(
    [...clock.timers.values()][0].dueAt,
    VAULT_IDLE_TIMEOUT_MS - VAULT_IDLE_WARNING_MS,
  );

  clock.setNow(VAULT_IDLE_TIMEOUT_MS - VAULT_IDLE_WARNING_MS);
  const [warningTimerID, warningTimer] = [...clock.timers.entries()][0];
  clock.timers.delete(warningTimerID);
  warningTimer.callback();
  assert.equal(clock.warningCount, 1);
  assert.equal([...clock.timers.values()][0].dueAt, VAULT_IDLE_TIMEOUT_MS);

  clock.setNow(VAULT_IDLE_TIMEOUT_MS - 10_000);
  clock.idleLock.recheck();
  assert.equal(clock.warningCount, 1);

  clock.setNow(VAULT_IDLE_TIMEOUT_MS - 9_000);
  clock.idleLock.activity();
  assert.equal(clock.warningCount, 1);
  assert.equal(clock.activityCount, 2);
  assert.equal(
    [...clock.timers.values()][0].dueAt,
    2 * VAULT_IDLE_TIMEOUT_MS - 9_000 - VAULT_IDLE_WARNING_MS,
  );
  assert.equal(clock.lockCount, 0);
});

test("background re-check uses elapsed idle time instead of granting a fresh window", () => {
  const clock = makeClock();
  clock.idleLock.activity();
  clock.setNow(VAULT_IDLE_TIMEOUT_MS - 1000);

  clock.idleLock.recheck();

  assert.equal(clock.lockCount, 0);
  assert.equal([...clock.timers.values()][0].dueAt, VAULT_IDLE_TIMEOUT_MS);

  clock.setNow(VAULT_IDLE_TIMEOUT_MS);
  clock.idleLock.recheck();
  assert.equal(clock.lockCount, 1);
  assert.equal(clock.timers.size, 0);
});

test("recent real interaction extends the lock deadline", () => {
  const clock = makeClock();
  clock.idleLock.activity();
  clock.setNow(VAULT_IDLE_TIMEOUT_MS - 1000);

  clock.idleLock.activity();

  assert.equal(clock.lockCount, 0);
  assert.equal(
    [...clock.timers.values()][0].dueAt,
    2 * VAULT_IDLE_TIMEOUT_MS - 1000 - VAULT_IDLE_WARNING_MS,
  );
});

test("locked sessions and disposed handlers do not create new timers", () => {
  const clock = makeClock();
  clock.idleLock.activity();
  clock.setUnlocked(false);
  clock.idleLock.activity();
  assert.equal(clock.timers.size, 0);

  clock.setUnlocked(true);
  clock.idleLock.activity();
  clock.idleLock.dispose();
  clock.idleLock.activity();
  clock.idleLock.recheck();
  assert.equal(clock.timers.size, 0);
});
