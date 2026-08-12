import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRateLimits } from '../src/codex.js';

test('normalizes 5-hour and weekly windows by duration', () => {
  const normalized = normalizeRateLimits(
    {
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 58, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 82, windowDurationMins: 10080, resetsAt: 1_800_100_000 },
        rateLimitReachedType: null,
        spendControlReached: false,
      },
    },
    new Date('2026-08-12T00:00:00Z'),
  );

  assert.equal(normalized.fiveHour.remainingPercent, 42);
  assert.equal(normalized.weekly.remainingPercent, 18);
  assert.equal(normalized.fiveHour.windowDurationMinutes, 300);
  assert.equal(normalized.weekly.windowDurationMinutes, 10080);
});

test('prefers the codex bucket from rateLimitsByLimitId', () => {
  const normalized = normalizeRateLimits({
    rateLimits: { primary: { usedPercent: 1, windowDurationMins: 60 } },
    rateLimitsByLimitId: {
      codex_other: { primary: { usedPercent: 90, windowDurationMins: 300 } },
      codex: {
        primary: { usedPercent: 20, windowDurationMins: 300 },
        secondary: { usedPercent: 30, windowDurationMins: 10080 },
      },
    },
  });

  assert.equal(normalized.fiveHour.remainingPercent, 80);
  assert.equal(normalized.weekly.remainingPercent, 70);
});

test('does not invent missing windows', () => {
  const normalized = normalizeRateLimits({
    rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300 } },
  });

  assert.equal(normalized.fiveHour.remainingPercent, 75);
  assert.equal(normalized.weekly, null);
});
