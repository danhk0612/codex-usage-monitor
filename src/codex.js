import { spawn } from 'node:child_process';
import readline from 'node:readline';

const FIVE_HOUR_MINUTES = 5 * 60;
const WEEKLY_MINUTES = 7 * 24 * 60;
const WINDOW_TOLERANCE = 0.05;
const DEFAULT_TIMEOUT_MS = 15_000;

function isApproximateWindow(actual, expected) {
  if (!Number.isFinite(actual)) return false;
  return actual >= expected * (1 - WINDOW_TOLERANCE) && actual <= expected * (1 + WINDOW_TOLERANCE);
}

function toIsoTimestamp(unixSeconds) {
  if (!Number.isFinite(unixSeconds)) return null;
  const date = new Date(unixSeconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeWindow(window) {
  if (!window || !Number.isFinite(window.usedPercent)) return null;

  const usedPercent = Math.min(100, Math.max(0, window.usedPercent));
  return {
    usedPercent,
    remainingPercent: Math.min(100, Math.max(0, 100 - usedPercent)),
    windowDurationMinutes: Number.isFinite(window.windowDurationMins)
      ? window.windowDurationMins
      : null,
    resetsAt: toIsoTimestamp(window.resetsAt),
  };
}

function selectCodexSnapshot(result) {
  const byLimitId = result?.rateLimitsByLimitId;
  if (byLimitId && typeof byLimitId === 'object') {
    if (byLimitId.codex) return byLimitId.codex;
    const codexEntry = Object.entries(byLimitId).find(([key, value]) =>
      key.toLowerCase() === 'codex' || value?.limitId?.toLowerCase() === 'codex',
    );
    if (codexEntry) return codexEntry[1];
  }
  return result?.rateLimits ?? null;
}

function findWindow(snapshot, expectedMinutes) {
  if (!snapshot) return null;
  return [snapshot.primary, snapshot.secondary].find((window) =>
    isApproximateWindow(window?.windowDurationMins, expectedMinutes),
  ) ?? null;
}

export function normalizeRateLimits(result, checkedAt = new Date()) {
  const snapshot = selectCodexSnapshot(result);
  if (!snapshot) {
    throw new Error('Codex app-server response did not include rateLimits');
  }

  return {
    checkedAt: checkedAt.toISOString(),
    fiveHour: normalizeWindow(findWindow(snapshot, FIVE_HOUR_MINUTES)),
    weekly: normalizeWindow(findWindow(snapshot, WEEKLY_MINUTES)),
    rateLimitReachedType: snapshot.rateLimitReachedType ?? null,
    spendControlReached: snapshot.spendControlReached ?? null,
  };
}

function writeMessage(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

export async function readCodexRateLimits({
  command = process.env.CODEX_COMMAND || 'codex',
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let settled = false;
    let stderr = '';
    let initialized = false;
    const rl = readline.createInterface({ input: child.stdout });

    const cleanup = () => {
      clearTimeout(timer);
      rl.close();
      if (!child.killed) child.kill('SIGTERM');
    };

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for Codex app-server after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });

    child.on('error', (error) => finish(error));
    child.on('exit', (code, signal) => {
      if (!settled) {
        const details = stderr.trim() ? `: ${stderr.trim()}` : '';
        finish(new Error(`Codex app-server exited before a response (code=${code}, signal=${signal})${details}`));
      }
    });

    rl.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.id === 1) {
        if (message.error) {
          finish(new Error(`Codex app-server initialize failed: ${message.error.message ?? 'unknown error'}`));
          return;
        }
        if (!initialized) {
          initialized = true;
          writeMessage(child, { method: 'initialized', params: {} });
          writeMessage(child, { method: 'account/rateLimits/read', id: 2 });
        }
        return;
      }

      if (message.id === 2) {
        if (message.error) {
          finish(new Error(`Codex rate-limit read failed: ${message.error.message ?? 'unknown error'}`));
          return;
        }
        try {
          finish(null, normalizeRateLimits(message.result));
        } catch (error) {
          finish(error);
        }
      }
    });

    writeMessage(child, {
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: {
          name: 'codex_usage_monitor',
          title: 'Codex Usage Monitor',
          version: '0.1.0',
        },
      },
    });
  });
}
