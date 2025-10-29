module.exports = {
  apps: [{
    name: 'musicbot',
    script: 'run.py',
    
    // Python 인터프리터 설정
    // 옵션 1: 시스템 Python3 사용 (기본값)
    interpreter: 'python3',
    
    // 옵션 2: 가상환경 Python 사용 (venv가 있는 경우 - 우분투/맥)
    // interpreter: './venv/bin/python',
    
    // 옵션 3: 가상환경 Python 사용 (inter 폴더가 있는 경우 - 우분투/맥)
    // interpreter: './inter/bin/python',
    
    // 옵션 4: Windows 가상환경 사용
    // interpreter: './venv/Scripts/python.exe',
    
    // 자동 재시작 설정
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    
    // 환경 변수
    env: {
      NODE_ENV: 'production',
      PYTHONUNBUFFERED: '1'
    },
    
    // 로그 설정
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // 재시작 설정
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    
    // 프로세스 관리
    instances: 1,
    exec_mode: 'fork',
    
    // 종료 신호
    kill_timeout: 5000,
    
    // 작업 디렉토리
    cwd: './',
    
    // 추가 옵션
    ignore_watch: [
      'node_modules',
      'logs',
      'audio_cache',
      'data',
      'venv',
      '.git'
    ],
    
    // 사용자 지정 (필요한 경우)
    // user: 'your_username',
    
    // 시작 옵션 (run.py에 전달할 인자)
    args: ''
  }]
};

