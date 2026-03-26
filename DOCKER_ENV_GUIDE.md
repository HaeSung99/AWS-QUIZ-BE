# Docker 실행 가이드 (dev / prod 독립형)

## 파일 구조
- `docker-compose.dev.yml`: 개발(dev) 전용
- `docker-compose.prod.yml`: 운영(prod) 전용

## 개발(dev) 실행
```bash
docker compose -f docker-compose.dev.yml up --build
```

백그라운드 실행:
```bash
docker compose -f docker-compose.dev.yml up -d --build
```

종료:
```bash
docker compose -f docker-compose.dev.yml down
```

## 운영(prod) 실행
```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate
```

종료:
```bash
docker compose -f docker-compose.prod.yml down
```

## 인증서 갱신 (prod)
```bash
docker compose -f docker-compose.prod.yml run --rm certbot renew --quiet
docker compose -f docker-compose.prod.yml restart nginx
```

## .env 파일은 하나여도 되나?
가능합니다.

- 로컬(dev): `.env`
- 운영(prod): GitHub Secrets의 `PROD_ENV_FILE`에서 EC2 배포 시 `.env`로 생성

즉, 실제로는 환경별 파일을 따로 커밋하지 않아도 동작합니다.

## GitHub Secrets 설정 목록
배포 워크플로우(`.github/workflows/deploy.yml`) 기준 필수 값입니다.

- `DOCKER_USERNAME`: Docker Hub 계정명
- `DOCKER_PASSWORD`: Docker Hub 비밀번호 또는 액세스 토큰
- `EC2_HOST`: EC2 퍼블릭 IP 또는 도메인
- `EC2_SSH_KEY`: EC2 접속용 SSH 개인키(예: pem 전체 내용)
- `PROD_ENV_FILE`: 운영 환경 변수 전체 내용(멀티라인 문자열)

### PROD_ENV_FILE 권장 포함 항목
- `PORT`
- `CORS_ALLOWED_ORIGINS` (예: `https://awsquizkr.com,https://www.awsquizkr.com`)
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`
- `MONGODB_URI`
- `JWT_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

추가로 `NGINX_CONF_FILE`은 워크플로우에서 인증서 존재 여부로 자동 주입합니다.
