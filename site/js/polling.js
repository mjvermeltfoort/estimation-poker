import { CONFIG } from "./config.js";

let timerId = null;
let generation = 0;
let running = false;

export function stopPolling() {
  generation += 1;
  running = false;
  if (timerId !== null) window.clearTimeout(timerId);
  timerId = null;
}

export function startPolling(refresh) {
  stopPolling();
  const ownGeneration = generation;
  running = true;

  const schedule = () => {
    if (!running || ownGeneration !== generation) return;
    const delay = document.hidden ? CONFIG.hiddenPollingIntervalMs : CONFIG.pollingIntervalMs;
    timerId = window.setTimeout(run, delay);
  };

  const run = async () => {
    if (!running || ownGeneration !== generation) return;
    try {
      await refresh();
    } catch (error) {
      console.warn("Background refresh failed; another attempt will be made later.", error);
    } finally {
      schedule();
    }
  };

  schedule();
  return stopPolling;
}
