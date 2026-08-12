import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTelegramEvent } from '../src/telegram.js';

test('formats threshold notification', () => {
  const text = formatTelegramEvent({
    type: 'threshold',
    window: 'weekly',
    threshold: 10,
    current: { remainingPercent: 8, resetsAt: '2026-08-16T00:00:00Z' },
  });

  assert.match(text, /주간 한도/);
  assert.match(text, /10% 이하/);
  assert.match(text, /남음: 8%/);
});

test('formats availability restored notification', () => {
  const text = formatTelegramEvent({
    type: 'availabilityRestored',
    current: {
      fiveHour: { remainingPercent: 100, resetsAt: '2026-08-12T05:00:00Z' },
      weekly: { remainingPercent: 12, resetsAt: '2026-08-16T00:00:00Z' },
    },
  });

  assert.match(text, /사용 제한 상태가 해제/);
  assert.match(text, /5시간 한도/);
});
