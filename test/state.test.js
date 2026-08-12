import test from 'node:test';
import assert from 'node:assert/strict';
import { compareUsage, createEmptyState } from '../src/state.js';

function usage({ five = 100, weekly = 100, fiveReset = '2026-08-12T05:00:00Z', weeklyReset = '2026-08-16T00:00:00Z' } = {}) {
  return {
    checkedAt: '2026-08-12T00:00:00Z',
    fiveHour: { remainingPercent: five, usedPercent: 100 - five, resetsAt: fiveReset },
    weekly: { remainingPercent: weekly, usedPercent: 100 - weekly, resetsAt: weeklyReset },
    rateLimitReachedType: null,
    spendControlReached: false,
  };
}

test('first successful state emits one initial event', () => {
  const result = compareUsage(createEmptyState(), usage({ five: 42, weekly: 18 }));
  assert.deepEqual(result.events.map((event) => event.type), ['initial']);
  assert.deepEqual(result.nextState.notifiedThresholds.fiveHour, [50]);
  assert.deepEqual(result.nextState.notifiedThresholds.weekly, [50, 25]);
});

test('crossing 10 percent threshold emits once', () => {
  let state = compareUsage(createEmptyState(), usage({ weekly: 12 })).nextState;
  let result = compareUsage(state, usage({ weekly: 8 }));

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, 'threshold');
  assert.equal(result.events[0].threshold, 10);

  state = result.nextState;
  result = compareUsage(state, usage({ weekly: 8 }));
  assert.equal(result.events.length, 0);
});

test('large drop consolidates crossed thresholds into the lowest threshold warning', () => {
  const state = compareUsage(createEmptyState(), usage({ weekly: 60 })).nextState;
  const result = compareUsage(state, usage({ weekly: 23 }));

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].threshold, 25);
  assert.deepEqual(result.events[0].crossedThresholds, [50, 25]);
});

test('reset requires the previous boundary to pass, the next boundary to advance, and remaining usage to increase', () => {
  const previous = usage({ weekly: 3, weeklyReset: '2026-08-16T00:00:00Z' });
  const state = compareUsage(createEmptyState(), previous).nextState;

  const afterReset = {
    ...usage({ weekly: 100, weeklyReset: '2026-08-23T00:00:00Z' }),
    checkedAt: '2026-08-16T00:30:00Z',
  };
  const reset = compareUsage(state, afterReset);
  assert.equal(reset.events[0].type, 'reset');

  const beforeBoundary = {
    ...usage({ weekly: 100, weeklyReset: '2026-08-23T00:00:00Z' }),
    checkedAt: '2026-08-15T23:30:00Z',
  };
  const notYetReset = compareUsage(state, beforeBoundary);
  assert.notEqual(notYetReset.events[0]?.type, 'reset');

  const noIncrease = {
    ...usage({ weekly: 3, weeklyReset: '2026-08-23T00:00:00Z' }),
    checkedAt: '2026-08-16T00:30:00Z',
  };
  const notReset = compareUsage(state, noIncrease);
  assert.notEqual(notReset.events[0]?.type, 'reset');
});

test('official rate-limit state clearing emits availability restored once', () => {
  const limited = {
    ...usage({ five: 0, weekly: 12 }),
    rateLimitReachedType: 'rate_limit_reached',
  };
  const state = compareUsage(createEmptyState(), limited).nextState;

  const restored = {
    ...usage({ five: 100, weekly: 12 }),
    checkedAt: '2026-08-12T01:00:00Z',
    rateLimitReachedType: null,
  };
  const result = compareUsage(state, restored);
  assert.ok(result.events.some((event) => event.type === 'availabilityRestored'));

  const next = compareUsage(result.nextState, restored);
  assert.ok(!next.events.some((event) => event.type === 'availabilityRestored'));
});
