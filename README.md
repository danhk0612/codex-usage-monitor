# Codex Usage Monitor

ChatGPT 계정에 연결된 Codex의 **사용량 한도**를 주기적으로 확인하고, 의미 있는 변화가 있을 때 Telegram으로 알리는 Docker 기반 모니터입니다.

기본 실행 대상은 **Synology NAS Container Manager**이며, 사전 빌드 이미지는 GitHub Container Registry(GHCR)에 게시합니다.

```text
ghcr.io/danhk0612/codex-usage-monitor:latest
```

## 동작 방식

이 프로젝트는 터미널의 `/status` 화면을 파싱하거나 ChatGPT 웹사이트를 스크래핑하지 않습니다. 검증된 Codex CLI `0.147.0`의 `codex app-server --stdio` JSON-RPC 인터페이스에서 `account/rateLimits/read`를 호출해 구조화된 rate-limit 데이터를 읽습니다.

Codex API가 제공하는 window만 사용합니다. 현재 계정/상태에 따라 주간 window만 제공되고 5시간 window가 없는 경우도 있으며, 이때 5시간 값을 추정하거나 `확인 불가`로 알림에 표시하지 않습니다.

기본 알림 조건:

- 최초 정상 조회 시 현재 상태 1회
- 제공되는 사용량 window의 남은 사용량이 `50%`, `25%`, `10%`, `5%`, `0%` 이하로 처음 내려간 경우
- 실제 reset window가 갱신된 것이 확인된 경우
- Codex의 구조화된 제한 상태가 해제되어 다시 사용 가능 상태가 확인된 경우
- Codex 사용량 조회가 연속 3회 실패한 경우

같은 임계값은 같은 window 안에서 반복 알림하지 않습니다.

Telegram의 날짜/시간은 `TZ` 기준으로 `YYYY년 MM월 DD일 HH시 mm분 ss초` 형식으로 표시합니다.

자세한 조사 근거는 [`docs/RESEARCH.md`](docs/RESEARCH.md)를 참고하세요.

## 필요 조건

- Docker / Docker Compose
- ChatGPT에서 사용할 수 있는 Codex 계정
- Telegram Bot Token
- Telegram Chat ID

## 빠른 설치

```bash
git clone https://github.com/danhk0612/codex-usage-monitor.git
cd codex-usage-monitor
cp .env.example .env
mkdir -p codex-data data
printf 'cli_auth_credentials_store = "file"\n' > codex-data/config.toml
```

`.env`에 실제 Telegram 값을 입력합니다.

```dotenv
TELEGRAM_BOT_TOKEN=123456789:YOUR_BOT_TOKEN
TELEGRAM_CHAT_ID=123456789
CHECK_INTERVAL_SECONDS=1800
TZ=Asia/Seoul
IMAGE_TAG=latest
```

실제 `.env`는 `.gitignore` 대상이며 저장소에 커밋하면 안 됩니다.

## Telegram 설정

1. Telegram의 **BotFather**에서 Bot을 생성하고 Bot Token을 발급받습니다.
2. 생성한 Bot과 대화를 시작하고 `/start`를 한 번 보냅니다.
3. 다음과 같이 `getUpdates`를 호출해 응답의 `message.chat.id` 값을 확인합니다.

```bash
set -a
source .env
set +a
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"
```

4. 확인한 Chat ID를 `.env`의 `TELEGRAM_CHAT_ID`에 저장합니다.

이 프로젝트는 Telegram에서 명령을 받지 않으며 알림 전송만 사용합니다.

## Codex 최초 로그인

Codex 인증 정보는 이미지에 넣지 않고 호스트의 `./codex-data`를 컨테이너의 `/root/.codex`에 연결해 영속화합니다.

먼저 이미지를 받습니다.

```bash
docker compose pull
```

headless 환경에서 device authorization으로 로그인합니다.

```bash
docker compose run --rm codex-usage-monitor codex login --device-auth
```

표시되는 URL/코드를 PC 또는 휴대폰 브라우저에서 열어 ChatGPT 계정으로 인증합니다. 인증 상태는 다음으로 확인할 수 있습니다.

```bash
docker compose run --rm codex-usage-monitor codex login status
```

정상이라면 다음과 같이 표시됩니다.

```text
Logged in using ChatGPT
```

### NAS에서 device login이 실패하는 경우

환경에 따라 Codex CLI의 device-auth HTTPS 요청이 실패할 수 있습니다. 이 경우 다른 PC에 동일한 Codex CLI 버전을 설치해 로그인한 뒤 생성된 `auth.json`을 NAS로 복사할 수 있습니다.

```bash
npm install -g @openai/codex@0.147.0
codex login --device-auth
```

Windows의 기본 CLI 인증 파일 위치는 일반적으로 다음과 같습니다.

```text
%USERPROFILE%\.codex\auth.json
```

이 파일을 NAS의 다음 위치에 복사합니다.

```text
<repository>/codex-data/auth.json
```

복사 후 권한을 제한합니다.

```bash
chmod 600 codex-data/auth.json
```

`auth.json`에는 실제 인증 정보가 들어 있으므로 내용을 채팅, 이슈, 로그 등에 공개하거나 저장소에 커밋하지 마세요.

## 실행

```bash
docker compose up -d
```

상태 확인:

```bash
docker compose ps
```

로그 확인:

```bash
docker compose logs -f codex-usage-monitor
```

정상 실행 시 다음과 비슷한 로그가 보입니다.

```text
INFO Starting Codex Usage Monitor; interval=1800s
INFO Codex usage check completed (0 notification event(s))
```

`0 notification event(s)`는 오류가 아니라, 이전 조회 이후 새로 알릴 변화가 없다는 뜻입니다.

최초 정상 조회와 Telegram 전송이 성공하면 현재 Codex 상태가 한 번 전송됩니다. 이후에는 의미 있는 변화가 있을 때만 알립니다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---:|---|
| `TELEGRAM_BOT_TOKEN` | 없음 | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | 없음 | Telegram 알림을 받을 Chat ID |
| `CHECK_INTERVAL_SECONDS` | `1800` | Codex 사용량 확인 주기(초) |
| `TZ` | `Asia/Seoul` | Telegram에 표시할 시간대 |
| `IMAGE_TAG` | `latest` | 사용할 GHCR 이미지 태그 |

애플리케이션 내부 상태는 `/app/data/state.json`에 저장되며 compose에서 `./data`에 영속화됩니다.

## Synology Container Manager

예시 배포 위치는 `/volume1/docker/codex-usage-monitor`이지만 코드나 compose에는 NAS 경로가 하드코딩되어 있지 않습니다.

SSH 기준 설치 예:

```bash
cd /volume1/docker
git clone https://github.com/danhk0612/codex-usage-monitor.git
cd codex-usage-monitor
cp .env.example .env
mkdir -p codex-data data
printf 'cli_auth_credentials_store = "file"\n' > codex-data/config.toml
docker compose pull
```

이후 `.env`를 편집하고 Codex 인증을 완료한 뒤 실행합니다.

```bash
docker compose up -d
```

Container Manager의 **프로젝트** 기능을 사용할 경우 저장소 디렉터리의 `compose.yml`을 프로젝트 구성으로 사용할 수 있습니다.

## 업데이트

사전 빌드 이미지를 사용하는 기본 운영 방식:

```bash
git pull
docker compose pull
docker compose up -d
```

인증 파일과 상태 파일은 호스트 볼륨에 유지되므로 컨테이너를 재생성해도 보존됩니다.

## 소스에서 직접 빌드

Dockerfile에는 검증된 Codex CLI `0.147.0`이 기본값으로 고정되어 있습니다.

```bash
docker build -t codex-usage-monitor:local .
```

다른 Codex CLI 버전을 검증해 사용할 경우:

```bash
docker build \
  --build-arg CODEX_VERSION=0.147.0 \
  -t codex-usage-monitor:local .
```

Codex CLI 버전을 올릴 때는 먼저 해당 버전에서 `account/rateLimits/read` 응답 구조가 유지되는지 확인한 뒤 Dockerfile과 `docs/RESEARCH.md`를 함께 갱신하세요.

## Docker 이미지 배포

`main`의 Docker 관련 코드가 변경되면 GitHub Actions가 다음 이미지를 GHCR에 게시합니다.

```text
ghcr.io/danhk0612/codex-usage-monitor:latest
ghcr.io/danhk0612/codex-usage-monitor:<commit-sha>
```

`latest`는 일반 배포용이고 commit SHA 태그는 특정 버전으로 되돌릴 때 사용할 수 있습니다.

## 문제 해결

### Codex 인증 만료 또는 로그인 문제

```bash
docker compose run --rm codex-usage-monitor codex login status
```

필요하면 다시 인증하거나 위의 `auth.json` 복사 절차를 사용합니다.

### Codex usage 조회 실패

```bash
docker compose logs -f codex-usage-monitor
```

`Codex usage collection failed`가 반복되는지 확인합니다.

5시간 rate-limit window가 API 응답에 없는 것은 오류가 아닙니다. 모니터는 제공되는 window만 추적합니다.

### Telegram 전송 실패

`TELEGRAM_BOT_TOKEN`과 `TELEGRAM_CHAT_ID`를 확인하고 컨테이너 로그의 `Telegram notification failed` 메시지를 확인하세요.

`Bad Request: chat not found`가 나오면 Bot과 대화를 시작했는지, `getUpdates`에서 확인한 실제 `chat.id`를 사용했는지 확인합니다.

Telegram 전송이 실패하면 해당 상태 변경을 저장하지 않아 다음 조회 때 같은 알림을 다시 시도합니다.

### 테스트용 one-off 컨테이너 정리

```bash
docker compose down --remove-orphans
docker ps -a --filter "name=codex-usage-monitor"
```

필요한 경우 중지된 테스트 컨테이너만 확인 후 제거합니다. `codex-data/`와 `data/`는 호스트 디렉터리이므로 compose 컨테이너를 삭제해도 유지됩니다.

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

외부 런타임 의존성이 없어 Node.js 20 이상에서 테스트할 수 있습니다.

```bash
npm test
```

테스트는 rate-limit 정규화, duration 기반 window 판별, 임계값 중복 방지, reset 판정, 공식 제한 상태 해제 및 Telegram 메시지 포맷을 검증합니다.

## 라이선스

MIT License. 자세한 내용은 [`LICENSE`](LICENSE)를 참고하세요.
