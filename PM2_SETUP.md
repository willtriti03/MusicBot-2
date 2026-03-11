# PM2 설정 가이드

MusicBot을 PM2로 관리해 자동 재시작, 로그 관리, 프로세스 모니터링을 할 수 있습니다.

## 1. 전제 조건

- Python 3.10, 3.11, 3.12, 3.13 중 하나가 설치되어 있어야 합니다.
- 의존성은 현재 Python 환경에 직접 설치합니다.

```bash
python3.13 -m pip install -r requirements.lock
```

## 2. PM2 설치

```bash
pm2 --version
```

PM2가 없다면 Node.js 설치 후 아래를 실행하세요.

```bash
sudo npm install -g pm2
```

## 3. 설정 파일 확인

`ecosystem.config.js`는 시스템 Python을 사용하도록 설정되어 있습니다.

```javascript
interpreter: 'python3',
```

필요하면 `python3.13`처럼 명시적인 실행 파일로 바꿔도 됩니다.

## 4. PM2로 시작

```bash
pm2 start ecosystem.config.js
pm2 status
pm2 logs musicbot
```

## 5. 자주 쓰는 명령

```bash
pm2 restart musicbot
pm2 stop musicbot
pm2 delete musicbot
pm2 save
pm2 startup
```

## 6. 문제 해결

```bash
which python3
python3 --version
pm2 describe musicbot
python3 run.py
```
