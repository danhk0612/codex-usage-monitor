function formatDateTime(iso, timeZone) {
  if (!iso) return '확인 불가';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '확인 불가';

  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}년 ${values.month}월 ${values.day}일 ${values.hour}시 ${values.minute}분 ${values.second}초`;
}

function windowName(window) {
  return window === 'fiveHour' ? '5시간 한도' : '주간 한도';
}

function windowLines(name, value, timeZone) {
  if (!value) return [];
  return [
    name,
    `남음: ${Math.round(value.remainingPercent)}%`,
    `Reset: ${formatDateTime(value.resetsAt, timeZone)}`,
  ];
}

function joinWindowSections(sections) {
  return sections.filter((section) => section.length > 0).flatMap((section, index) =>
    index === 0 ? section : ['', ...section],
  );
}

export function formatTelegramEvent(event, { timeZone = 'Asia/Seoul' } = {}) {
  if (event.type === 'initial') {
    return [
      '[Codex Usage]',
      '',
      ...joinWindowSections([
        windowLines('5시간 한도', event.current.fiveHour, timeZone),
        windowLines('주간 한도', event.current.weekly, timeZone),
      ]),
      '',
      `확인: ${formatDateTime(event.current.checkedAt, timeZone)}`,
    ].join('\n');
  }

  if (event.type === 'threshold') {
    return [
      '[Codex Usage Warning]',
      '',
      `${windowName(event.window)}가 ${event.threshold}% 이하로 내려갔습니다.`,
      '',
      `남음: ${Math.round(event.current.remainingPercent)}%`,
      `Reset: ${formatDateTime(event.current.resetsAt, timeZone)}`,
    ].join('\n');
  }

  if (event.type === 'reset') {
    return [
      '[Codex Usage Reset]',
      '',
      `${windowName(event.window)}가 초기화되었습니다.`,
      '',
      `이전: ${Math.round(event.previous.remainingPercent)}%`,
      `현재: ${Math.round(event.current.remainingPercent)}%`,
      '',
      `다음 Reset: ${formatDateTime(event.current.resetsAt, timeZone)}`,
    ].join('\n');
  }

  if (event.type === 'availabilityRestored') {
    return [
      '[Codex Usage Available]',
      '',
      'Codex 사용 제한 상태가 해제되었습니다.',
      '',
      ...joinWindowSections([
        windowLines('5시간 한도', event.current.fiveHour, timeZone),
        windowLines('주간 한도', event.current.weekly, timeZone),
      ]),
    ].join('\n');
  }

  if (event.type === 'failure') {
    return [
      '[Codex Usage Monitor Error]',
      '',
      `Codex 사용량 조회가 ${event.count}회 연속 실패했습니다.`,
      'Container 로그와 Codex 인증 상태를 확인하세요.',
    ].join('\n');
  }

  throw new Error(`Unsupported Telegram event type: ${event.type}`);
}

export async function sendTelegramMessage(text, { token, chatId, fetchImpl = fetch }) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is required');

  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram send failed (${response.status}): ${body.slice(0, 500)}`);
  }
}
