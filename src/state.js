import fs from 'node:fs/promises';
import path from 'node:path';

export const THRESHOLDS = [50, 25, 10, 5, 0];

export function createEmptyState() {
  return {
    lastUsage: null,
    notifiedThresholds: {
      fiveHour: [],
      weekly: [],
    },
    consecutiveFailures: 0,
    failureNotified: false,
  };
}

export async function loadState(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return { ...createEmptyState(), ...JSON.parse(text) };
  } catch (error) {
    if (error.code === 'ENOENT') return createEmptyState();
    throw error;
  }
}

export async function saveState(filePath, state) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

function thresholdSetForCurrent(remainingPercent) {
  if (!Number.isFinite(remainingPercent)) return [];
  return THRESHOLDS.filter((threshold) => remainingPercent <= threshold);
}

function detectReset(previous, current, checkedAt) {
  if (!previous || !current) return false;
  if (!previous.resetsAt || !current.resetsAt || !checkedAt) return false;

  const previousReset = new Date(previous.resetsAt).getTime();
  const currentReset = new Date(current.resetsAt).getTime();
  const checked = new Date(checkedAt).getTime();
  if (![previousReset, currentReset, checked].every(Number.isFinite)) return false;

  const previousBoundaryPassed = previousReset <= checked;
  const nextBoundaryAdvanced = currentReset > previousReset;
  const remainingIncreased = current.remainingPercent > previous.remainingPercent;
  return previousBoundaryPassed && nextBoundaryAdvanced && remainingIncreased;
}

function thresholdEvent(name, current, notified) {
  if (!current || !Number.isFinite(current.remainingPercent)) return null;

  const newlyReached = THRESHOLDS.filter(
    (threshold) => current.remainingPercent <= threshold && !notified.includes(threshold),
  );
  if (newlyReached.length === 0) return null;

  return {
    type: 'threshold',
    window: name,
    threshold: Math.min(...newlyReached),
    current,
    crossedThresholds: newlyReached,
  };
}

export function compareUsage(state, current) {
  const next = structuredClone(state);
  const events = [];
  const previous = state.lastUsage;

  if (!previous) {
    events.push({ type: 'initial', current });
    next.notifiedThresholds = {
      fiveHour: thresholdSetForCurrent(current.fiveHour?.remainingPercent),
      weekly: thresholdSetForCurrent(current.weekly?.remainingPercent),
    };
    next.lastUsage = current;
    return { events, nextState: next };
  }

  if (previous.rateLimitReachedType && !current.rateLimitReachedType) {
    events.push({
      type: 'availabilityRestored',
      previousReason: previous.rateLimitReachedType,
      current,
    });
  }

  for (const [key, label] of [
    ['fiveHour', 'fiveHour'],
    ['weekly', 'weekly'],
  ]) {
    const wasReset = detectReset(previous[key], current[key], current.checkedAt);
    if (wasReset) {
      events.push({
        type: 'reset',
        window: label,
        previous: previous[key],
        current: current[key],
      });
      next.notifiedThresholds[key] = thresholdSetForCurrent(current[key]?.remainingPercent);
      continue;
    }

    const event = thresholdEvent(key, current[key], next.notifiedThresholds[key] ?? []);
    if (event) {
      events.push(event);
      next.notifiedThresholds[key] = [
        ...new Set([...(next.notifiedThresholds[key] ?? []), ...event.crossedThresholds]),
      ].sort((a, b) => b - a);
    }
  }

  next.lastUsage = current;
  return { events, nextState: next };
}
