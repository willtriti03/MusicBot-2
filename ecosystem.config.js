module.exports = {
  apps: [{
    name: 'musicbot',
    script: 'run.py',
    
    // 시스템 Python 3.10-3.13 사용
    interpreter: 'python3',
    
    // 자동 재시작 설정
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    
    // 환경 변수
    env: {
      NODE_ENV: 'production',
      PYTHONUNBUFFERED: '1'
      // MUSICBOT_NODE_BIN: '/usr/bin/node'
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
      '.git'
    ],
    
    // 사용자 지정 (필요한 경우)
    // user: 'your_username',
    
    // 시작 옵션 (run.py에 전달할 인자)
    args: ''
  }]
};
