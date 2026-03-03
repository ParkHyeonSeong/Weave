# Weave 서버 배포 가이드

Docker + Docker Compose가 설치된 리눅스 서버라면 어디서든 배포 가능합니다.

## 사전 요구사항

- Linux 서버 (Ubuntu 22.04+ 권장)
- Docker Engine 24+
- Docker Compose v2+
- 도메인 1개 (A 레코드가 서버 IP를 가리키도록 설정)
- 80, 443 포트 오픈 (방화벽/보안그룹)

## 배포 순서

### 1. 프로젝트 클론

```bash
git clone <repo-url> /opt/weave
cd /opt/weave
```

### 2. 환경변수 설정

```bash
cp .env.production.example .env.production
```

`.env.production` 파일을 열어 값을 입력:

```env
DOMAIN=weave.example.com
CERTBOT_EMAIL=admin@example.com
POSTGRES_PASSWORD=여기에_강력한_랜덤_비밀번호
ALLOWED_ORIGINS=https://weave.example.com
NEXT_PUBLIC_API_URL=https://weave.example.com
```

### 3. SSL 인증서 초기 발급

SSL 인증서 발급을 위해 먼저 Nginx를 HTTP 모드로 띄워야 합니다.

```bash
# Nginx를 certbot 검증 가능한 상태로 임시 시작
docker compose -f docker-compose.prod.yml up -d nginx

# 인증서 발급
make ssl-init

# Nginx 재시작 (SSL 인증서 적용)
docker compose -f docker-compose.prod.yml restart nginx
```

> **참고**: `ssl-init` 실행 전에 도메인의 DNS A 레코드가 서버 IP를 가리키고 있어야 합니다.

### 4. 서비스 시작

```bash
make prod-build
```

### 5. 확인

```bash
# 서비스 상태 확인
make prod-ps

# 로그 확인
make prod-logs
```

브라우저에서 `https://your-domain.com` 접속하여 확인.

## 유용한 명령어

| 명령어 | 설명 |
|--------|------|
| `make prod` | 프로덕션 서비스 시작 |
| `make prod-build` | 빌드 후 시작 |
| `make prod-down` | 서비스 중지 |
| `make prod-logs` | 로그 확인 |
| `make prod-ps` | 서비스 상태 |
| `make ssl-renew` | SSL 인증서 갱신 |

## SSL 인증서 자동 갱신

certbot 컨테이너가 12시간마다 자동으로 갱신을 시도합니다. 별도 설정 불필요.

## 업데이트

```bash
cd /opt/weave
git pull
make prod-build
```
