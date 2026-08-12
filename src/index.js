import { readCodexRateLimits } from './codex.js';
import { compareUsage, loadState, saveState } from './state.js';
import { formatTelegramEvent, sendTelegramMessage } from './telegram.js';

const FAILURE_ALERT_AFTER = 3;
const DEFAULT_INTERVAL_SECONDS = 1800;
const DEFAULT_STATE_PATH = '/app/data/state.json';

function log(level, message, error) {
  const suffix = error ? `: ${error instanceof Error ? error.message : String(error)}` : '';
  console.log(`${new Date().toISOString()} ${level} ${message}${suffix}`);
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const config = {
  intervalSeconds: positiveInteger(process.env.CHECK_INTERVAL_SECONDS, DEFAULT_INTERVAL_SECONDS),
  statePath: process.env.STATE_PATH || DEFAULT_STATE_PATH,
  timeZone: process.env.TZ || 'Asia/Seoul',
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
};

async function notify(events) {
  for (const event of events) {
    const text = formatTelegramEvent(event, { timeZone: config.timeZone });
    await sendTelegramMessage(text, {
      token: config.telegramToken,
      chatId: config.telegramChatId,
    });
  }
}

async function recordCollectionFailure(state, error) {
  const next = {
    ...state,
    consecutiveFailures: (state.consecutiveFailures ?? 0) + 1,
  };

  log('ERROR', 'Codex usage collection failed', error);

  if (next.consecutiveFailures >= FAILURE_ALERT_AFTER && !next.failureNotified) {
    try {
      await notify([{ type: 'failure', count: next.consecutiveFailures }]);
      next.failureNotified = true;
    } catch (telegramError) {
      log('ERROR', 'Failed to send monitor failure notification', telegramError);
    }
  }

  await saveState(config.statePath, next);
}

export async function runCycle() {
  const state = await loadState(config.statePath);

  let current;
  try {
    current = await readCodexRateLimits();
    if (!current.fiveHour && !current.weekly) {
      throw new Error('Neither the 5-hour nor weekly Codex rate-limit window is available');
    }
  } catch (error) {
    await recordCollectionFailure(state, error);
    return;
  }

  if (!current.fiveHour) log('WARN', '5-hour Codex rate-limit window is unavailable');
  if (!current.weekly) log('WARN', 'Weekly Codex rate-limit window is unavailable');

  const { events, nextState } = compareUsage(state, current);

  try {
    await notify(events);
  } catch (error) {
    log('ERROR', 'Telegram notification failed; state was not advanced so the notification can retry', error);
    return;
  }

  const healthyState = {
    ...nextState,
    consecutiveFailures: 0,
    failureNotified: false,
  };
  await saveState(config.statePath, healthyState);
  log('INFO', `Codex usage check completed (${events.length} notification event(s))`);
}

async function main() {
  log('INFO', `Starting Codex Usage Monitor; interval=${config.intervalSeconds}s`);
  for (;;) {
    await runCycle();
    await new Promise((resolve) => setTimeout(resolve, config.intervalSeconds * 1000));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    log('ERROR', 'Fatal monitor error', error);
    process.exitCode = 1;
  });
}
