#!/bin/bash
# PM2 설정 및 설치 스크립트

echo "MusicBot PM2 설정 스크립트"
echo "=========================="
echo ""

# PM2 설치 확인
if ! command -v pm2 &> /dev/null; then
    echo "PM2가 설치되어 있지 않습니다."
    echo "PM2 설치 중..."
    
    # Node.js 확인
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js가 설치되어 있지 않습니다."
        echo "Node.js를 먼저 설치해주세요:"
        echo "  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
        echo "  sudo apt-get install -y nodejs"
        exit 1
    fi
    
    # PM2 전역 설치
    sudo npm install -g pm2
    
    if [ $? -eq 0 ]; then
        echo "✅ PM2 설치 완료"
    else
        echo "❌ PM2 설치 실패"
        exit 1
    fi
else
    echo "✅ PM2가 이미 설치되어 있습니다."
    pm2 --version
fi

echo ""
echo "Python 가상환경 확인 중..."

# Python 버전 확인
if command -v python3 &> /dev/null; then
    PYTHON_CMD=$(which python3)
    echo "✅ Python3 발견: $PYTHON_CMD"
else
    echo "⚠️  Python3를 찾을 수 없습니다."
    echo "   인터프리터 경로를 수동으로 설정해야 할 수 있습니다."
fi

# 가상환경 확인
if [ -d "venv" ] || [ -d "inter" ]; then
    if [ -f "venv/bin/python" ]; then
        echo "✅ 가상환경 발견: venv/bin/python"
        echo "   ecosystem.config.js의 interpreter를 'venv/bin/python'으로 설정하세요."
    elif [ -f "inter/bin/python" ]; then
        echo "✅ 가상환경 발견: inter/bin/python"
        echo "   ecosystem.config.js의 interpreter를 'inter/bin/python'으로 설정하세요."
    fi
else
    echo "⚠️  가상환경을 찾을 수 없습니다."
    echo "   시스템 Python을 사용합니다."
fi

echo ""
echo "로그 디렉토리 생성 중..."
mkdir -p logs

echo ""
echo "PM2 설정 확인:"
if [ -f "ecosystem.config.js" ]; then
    echo "✅ ecosystem.config.js 파일이 있습니다."
else
    echo "❌ ecosystem.config.js 파일이 없습니다."
    exit 1
fi

echo ""
echo "=========================="
echo "설정 완료!"
echo ""
echo "사용 방법:"
echo "  # PM2로 봇 시작"
echo "  pm2 start ecosystem.config.js"
echo ""
echo "  # 상태 확인"
echo "  pm2 status"
echo ""
echo "  # 로그 확인"
echo "  pm2 logs musicbot"
echo ""
echo "  # 봇 중지"
echo "  pm2 stop musicbot"
echo ""
echo "  # 봇 재시작"
echo "  pm2 restart musicbot"
echo ""
echo "  # 시스템 부팅 시 자동 시작"
echo "  pm2 startup"
echo "  pm2 save"
echo ""

