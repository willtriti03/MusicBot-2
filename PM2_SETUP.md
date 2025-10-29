# PM2 설정 가이드

MusicBot을 PM2로 관리하여 자동 재시작, 로그 관리, 프로세스 모니터링을 할 수 있습니다.

## 1. PM2 설치

### 우분투/Debian:
```bash
# Node.js 설치 (PM2는 Node.js가 필요합니다)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 전역 설치
sudo npm install -g pm2
```

### 설치 확인:
```bash
pm2 --version
```

## 2. 설정 파일 확인

`ecosystem.config.js` 파일이 있는지 확인하고, Python 경로를 설정하세요.

### Python 인터프리터 경로 설정

`ecosystem.config.js` 파일에서 `interpreter` 옵션을 수정:

**시스템 Python 사용 (기본):**
```javascript
interpreter: 'python3',
```

**가상환경 사용 (venv):**
```javascript
interpreter: './venv/bin/python',
```

**가상환경 사용 (inter 폴더):**
```javascript
interpreter: './inter/bin/python',
```

### Python 경로 확인:
```bash
# 시스템 Python
which python3

# 가상환경 Python (있는 경우)
which python3  # 또는
ls -la venv/bin/python
```

## 3. PM2로 봇 시작

### 기본 시작:
```bash
pm2 start ecosystem.config.js
```

### 설정 확인 후 시작:
```bash
# 설정 파일 검증
pm2 ecosystem ecosystem.config.js

# 시작
pm2 start musicbot
```

## 4. 유용한 PM2 명령어

### 상태 확인:
```bash
pm2 status
pm2 list
```

### 로그 확인:
```bash
# 실시간 로그
pm2 logs musicbot

# 최근 로그 (100줄)
pm2 logs musicbot --lines 100

# 에러 로그만
pm2 logs musicbot --err

# 출력 로그만
pm2 logs musicbot --out
```

### 프로세스 제어:
```bash
# 중지
pm2 stop musicbot

# 시작
pm2 start musicbot

# 재시작
pm2 restart musicbot

# 완전히 재시작 (graceful)
pm2 reload musicbot

# 삭제
pm2 delete musicbot
```

### 모니터링:
```bash
# 실시간 모니터링
pm2 monit

# 정보 확인
pm2 info musicbot

# 프로세스 트리 보기
pm2 list
```

## 5. 시스템 부팅 시 자동 시작

```bash
# 시작 스크립트 생성 (자동으로 올바른 사용자 선택)
pm2 startup

# 출력된 명령어 실행 (sudo 필요)
# 예: sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u username --hp /home/username

# 현재 PM2 프로세스 저장
pm2 save
```

### 자동 시작 제거:
```bash
pm2 unstartup
```

## 6. 로그 관리

로그는 `./logs/` 디렉토리에 저장됩니다:
- `pm2-error.log`: 에러 로그
- `pm2-out.log`: 출력 로그
- `pm2-combined.log`: 통합 로그

### 로그 로테이션 설정:
```bash
# PM2 모듈 설치
pm2 install pm2-logrotate

# 로그 보관 설정
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

## 7. 문제 해결

### Python 경로 문제:
```bash
# Python 경로 확인
which python3
python3 --version

# 가상환경 Python 경로 확인
ls -la venv/bin/python
./venv/bin/python --version
```

### 권한 문제:
```bash
# 파일 권한 확인
ls -la ecosystem.config.js
ls -la run.py

# 실행 권한 부여
chmod +x run.py
```

### PM2 프로세스가 시작되지 않을 때:
```bash
# 로그 확인
pm2 logs musicbot --lines 50

# 설정 재확인
pm2 describe musicbot

# 수동으로 실행하여 에러 확인
python3 run.py
```

## 8. 설정 예시

### 개발 환경 (watch 모드):
```javascript
{
  name: 'musicbot',
  script: 'run.py',
  interpreter: './venv/bin/python',
  watch: true,
  ignore_watch: ['node_modules', 'logs', 'audio_cache']
}
```

### 프로덕션 환경:
```javascript
{
  name: 'musicbot',
  script: 'run.py',
  interpreter: 'python3',
  autorestart: true,
  max_memory_restart: '1G',
  instances: 1
}
```

## 빠른 참조

```bash
# 한 줄로 설치 및 시작
bash pm2-setup.sh && pm2 start ecosystem.config.js

# 상태 확인
pm2 status

# 로그 보기
pm2 logs musicbot --lines 100

# 재시작
pm2 restart musicbot
```

