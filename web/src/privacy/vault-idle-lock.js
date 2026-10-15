export const VAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const VAULT_IDLE_WARNING_MS = 60 * 1000;

// Use wall-clock elapsed time and re-check on visibility restoration because
// mobile browsers may pause or heavily throttle timers in background tabs.
export function createVaultIdleLock({
  isUnlocked,
  lock,
  timeoutMs = VAULT_IDLE_TIMEOUT_MS,
  warningMs = VAULT_IDLE_WARNING_MS,
  onWarning = () => {},
  onActivity = () => {},
  now = () => Date.now(),
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (timer) => globalThis.clearTimeout(timer),
}) {
  let lastActivity = now();
  let timer = null;
  let disposed = false;
  let warningShown = false;

  function clear() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function recheck() {
    clear();
    if (disposed || !isUnlocked()) return;

    const remaining = timeoutMs - (now() - lastActivity);
    if (remaining <= 0) {
      lock();
      return;
    }

    if (!warningShown && remaining <= warningMs) {
      warningShown = true;
      onWarning();
    }

    const delay = warningShown ? remaining : remaining - warningMs;
    timer = setTimer(() => {
      timer = null;
      recheck();
    }, delay);
  }

  function activity() {
    if (disposed) return;
    if (!isUnlocked()) {
      clear();
      return;
    }
    lastActivity = now();
    warningShown = false;
    onActivity();
    recheck();
  }

  function dispose() {
    disposed = true;
    clear();
  }

  return { activity, recheck, dispose };
}
