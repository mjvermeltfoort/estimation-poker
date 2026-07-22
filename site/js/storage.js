export const STORAGE_KEYS = {
  selectedTeamId: "estimationPoker.selectedTeamId",
  selectedMemberId: "estimationPoker.selectedMemberId",
  facilitatorMemberId: "estimationPoker.facilitatorMemberId",
  lastSessionId: "estimationPoker.lastSessionId",
};

function resolveStorage(kind) {
  try {
    const storage = window[kind];
    const testKey = "estimationPoker.storageTest";
    storage.setItem(testKey, "1");
    storage.removeItem(testKey);
    return storage;
  } catch (error) {
    console.warn(`${kind} is unavailable.`, error);
    return null;
  }
}

export function getStoredValue(key, fallback = null, kind = "localStorage") {
  const storage = resolveStorage(kind);
  if (!storage) return fallback;
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch (error) {
    console.warn(`Invalid stored value for ${key}.`, error);
    return fallback;
  }
}

export function setStoredValue(key, value, kind = "localStorage") {
  const storage = resolveStorage(kind);
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Failed to save ${key}.`, error);
    return false;
  }
}

export function removeStoredValue(key, kind = "localStorage") {
  const storage = resolveStorage(kind);
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`Failed to remove ${key}.`, error);
    return false;
  }
}

export function roundStorageKey(sessionId, ticketId) {
  return `estimationPoker.round.${sessionId}.${ticketId}`;
}
