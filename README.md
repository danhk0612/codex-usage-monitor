# Codex Usage Monitor

ChatGPT 계정에 연결된 Codex의 **5시간 / 주간 사용량 한도**를 주기적으로 확인하고, 의미 있는 변화가 있을 때 Telegram으로 알리는 Docker 기반 모니터입니다.

기본 실행 대상은 **Synology NAS Container Manager**입니다.

## 동작 방식

이 프로젝트는 터미널의 `/status` 화면을 파싱하거나 ChatGPT 웹사이트를 스크래핑하지 않습니다. 검증된 Codex CLI `0.147.0`의 `codex app-server --stdio` JSON-RPC 인터페이스에서 `account/rateLimits/read`를 호출해 구조화된 rate-limit 데이터를 읽습니다.

기본 알림 조건:

- 최초 정상 조회 시 현재 상태 1회
- 5시간 / 주간 남은 사용량이 각각 `50%`, `25%`, `10%`, `5%`, `0%` 이하로 처음 내려간 경우
- 실제 reset window가 갱신된 것이 확인된 경우
- Codex의 구조화된 제한 상태가 해제되어 다시 사용 가능 상태가 확인된 경우
- Codex 사용량 조회가 연속 3회 실패한 경우

같은 임계값은 같은 window 안에서 반복 알림하지 않습니다.

자세한 조사 근거는 [`docs/RESEARCH.md`](docs/RESEARCH.md)를 참고하세요.

## 필요 조건

- Docker / Docker Compose
- ChatGPT에서 사용할 수 있는 Codex 계정
- Telegram Bot Token
- Telegram Chat ID

## 설치

```bash
git clone https://github.com/danhk0612/codex-usage-monitor.git
cd codex-usage-monitor
cp .env.example .env
```

`.env`에 실제 Telegram 값을 입력합니다.

```dotenv
TELEGRAM_BOT_TOKEN=123456789:YOUR_BOT_TOKEN
TELEGRAM_CHAT_ID=123456789
CHECK_INTERVAL_SECONDS=1800
TZ=Asia/Seoul
CODEX_VERSION=0.147.0
```

실제 `.env`는 `.gitignore` 대상이며 저장소에 커밋하면 안 됩니다.

## Telegram 설정

1. Telegram의 **BotFather**에서 Bot을 생성하고 Bot Token을 발급받습니다.
2. 생성한 Bot과 대화를 시작합니다.
3. 사용할 Chat ID를 확인합니다.
4. Token과 Chat ID를 `.env`에만 저장합니다.

이 프로젝트는 Telegram에서 명령을 받지 않으며 알림 전송만 사용합니다.

## Codex 최초 로그인

Codex 인증 정보는 이미지에 넣지 않고 호스트의 `./codex-data`를 컨테이너의 `/root/.codex`에 연결해 영속화합니다.

먼저 디렉터리와 Codex 설정 파일을 만듭니다.

```bash
mkdir -p codex-data data
printf 'cli_auth_credentials_store = "file"\n' > codex-data/config.toml
```

이미지를 빌드합니다.

```bash
docker compose build
```

headless 환경에서 device authorization으로 로그인합니다.

```bash
docker compose run --rm codex-usage-monitor codex login --device-auth
```

표시되는 URL/코드를 PC 또는 휴대폰 브라우저에서 열어 ChatGPT 계정으로 인증합니다. 인증은 `codex-data`에 유지되므로 컨테이너를 재생성해도 다시 로그인할 필요가 없습니다. 인증 상태는 다음으로 확인할 수 있습니다.

```bash
docker compose run --rm codex-usage-monitor codex login status
```

`codex-data/`에는 실제 credential이 저장되므로 GitHub에 업로드하지 마세요.

## 실행

```bash
docker compose up -d
```

로그 확인:

```bash
docker compose logs -f codex-usage-monitor
```

최초 정상 조회와 Telegram 전송이 성공하면 현재 Codex 상태가 한 번 전송됩니다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---:|---|
| `TELEGRAM_BOT_TOKEN` | 없음 | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | 없음 | Telegram 알림을 받을 Chat ID |
| `CHECK_INTERVAL_SECONDS` | `1800` | Codex 사용량 확인 주기(초) |
| `TZ` | `Asia/Seoul` | Telegram에 표시할 시간대 |
| `CODEX_VERSION` | `0.147.0` | Docker build 시 설치할 검증된 Codex CLI 버전 |

애플리케이션 내부 상태는 `/app/data/state.json`에 저장되며 compose에서 `./data`에 영속화됩니다.

## Synology Container Manager

예시 배포 위치는 `/volume1/docker/codex-usage-monitor`이지만 코드나 compose에는 NAS 경로가 하드코딩되어 있지 않습니다.

SSH를 사용할 수 있다면 가장 단순한 절차는 다음과 같습니다.

```bash
cd /volume1/docker
git clone https://github.com/danhk0612/codex-usage-monitor.git
cd codex-usage-monitor
cp .env.example .env
mkdir -p codex-data data
printf 'cli_auth_credentials_store = "file"\n' > codex-data/config.toml
```

이후 `.env`를 편집하고 다음 순서로 진행합니다.

```bash
docker compose build
docker compose run --rm codex-usage-monitor codex login --device-auth
docker compose up -d
```

Container Manager의 **프로젝트** 기능을 사용할 경우 저장소 디렉터리의 `compose.yml`을 프로젝트 구성으로 사용하면 됩니다. 단, 최초 Codex device login은 위의 `docker compose run --rm ...` 방식으로 먼저 수행하는 것을 권장합니다.

## 업데이트

```bash
git pull
docker compose build
docker compose up -d
```

Codex CLI 버전을 올릴 때는 먼저 해당 버전에서 `account/rateLimits/read` 응답 구조가 유지되는지 확인한 뒤 `.env`의 `CODEX_VERSION`과 `docs/RESEARCH.md`를 함께 갱신하세요.

## 문제 해결

### Codex 인증 만료 또는 로그인 문제

```bash
docker compose run --rm codex-usage-monitor codex login status
```

로그인이 필요하면 다시 인증합니다.

```bash
docker compose run --rm codex-usage-monitor codex login --device-auth
```

### Codex usage 조회 실패

```bash
docker compose logs -f codex-usage-monitor
```

`Codex usage collection failed` 또는 rate-limit window unavailable 로그를 확인하세요. 둘 다 필요한 window가 없는 상태가 연속되면 모니터는 정상 동작으로 간주하지 않습니다.

### Telegram 전송 실패

`TELEGRAM_BOT_TOKEN`과 `TELEGRAM_CHAT_ID`를 확인하고 컨테이너 로그의 `Telegram notification failed` 메시지를 확인하세요. Telegram 전송이 실패하면 해당 상태 변경을 저장하지 않아 다음 조회 때 같은 알림을 다시 시도합니다.

## 보안

다음 값은 저장소에 커밋하지 않습니다.

- `.env`
- `codex-data/`
- `auth.json` 및 Codex 인증 정보
- ChatGPT/Codex access/refresh token
- Telegram Bot Token
- Cookie / session credential
- `data/state.json`

Docker image에도 credential을 포함하지 않습니다.

## 개발 / 테스트

외부 런타임 의존성이 없어 Node.js 20 이상에서 바로 테스트할 수 있습니다.

```bash
npm test
```

현재 테스트는 rate-limit 정규화, duration 기반 5시간/주간 판별, 임계값 중복 방지, reset 판정, 공식 제한 상태 해제 및 Telegram 메시지 포맷을 검증합니다.
