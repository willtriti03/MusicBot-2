#!/bin/bash
# AudioCachePath 권한 수정 스크립트
# 우분투 환경에서 사용하세요

echo "MusicBot 캐시 디렉토리 권한 수정 스크립트"
echo "=========================================="
echo ""

# 현재 사용자 확인
CURRENT_USER=$(whoami)
CURRENT_DIR=$(pwd)

echo "현재 사용자: $CURRENT_USER"
echo "작업 디렉토리: $CURRENT_DIR"
echo ""

# 기본 캐시 디렉토리 경로
DEFAULT_CACHE_DIR="$CURRENT_DIR/audio_cache"

# AudioCachePath가 설정되어 있는지 확인 (옵션)
# config/options.ini에서 AudioCachePath 값을 읽어올 수 있지만, 
# 여기서는 기본 경로를 사용합니다.

CACHE_DIR="$DEFAULT_CACHE_DIR"

# 사용자가 경로를 지정한 경우
if [ -n "$1" ]; then
    CACHE_DIR="$1"
fi

echo "캐시 디렉토리: $CACHE_DIR"
echo ""

# 디렉토리가 존재하지 않으면 생성
if [ ! -d "$CACHE_DIR" ]; then
    echo "캐시 디렉토리가 없습니다. 생성 중..."
    mkdir -p "$CACHE_DIR"
    if [ $? -eq 0 ]; then
        echo "✅ 디렉토리 생성 완료"
    else
        echo "❌ 디렉토리 생성 실패"
        exit 1
    fi
else
    echo "✅ 캐시 디렉토리가 이미 존재합니다"
fi

# 권한 확인
echo ""
echo "현재 권한 확인:"
ls -ld "$CACHE_DIR"

# 권한 수정
echo ""
echo "권한 수정 중..."
chmod 755 "$CACHE_DIR"
if [ $? -eq 0 ]; then
    echo "✅ 권한 수정 완료 (755)"
else
    echo "❌ 권한 수정 실패"
    exit 1
fi

# 소유권 확인 및 변경
echo ""
echo "소유권 확인:"
CURRENT_OWNER=$(stat -c '%U:%G' "$CACHE_DIR")
echo "현재 소유자: $CURRENT_OWNER"

# 소유권을 현재 사용자로 변경
echo "소유권을 $CURRENT_USER:$CURRENT_USER로 변경 중..."
sudo chown -R "$CURRENT_USER:$CURRENT_USER" "$CACHE_DIR"
if [ $? -eq 0 ]; then
    echo "✅ 소유권 변경 완료"
else
    echo "⚠️  소유권 변경 실패 (sudo 권한 필요할 수 있습니다)"
fi

# 최종 권한 확인
echo ""
echo "최종 권한 확인:"
ls -ld "$CACHE_DIR"

# 쓰기 테스트
echo ""
echo "쓰기 권한 테스트 중..."
TEST_FILE="$CACHE_DIR/.bot-test-write"
if touch "$TEST_FILE" 2>/dev/null; then
    rm -f "$TEST_FILE"
    echo "✅ 쓰기 권한 테스트 성공"
else
    echo "❌ 쓰기 권한 테스트 실패"
    exit 1
fi

echo ""
echo "=========================================="
echo "✅ 모든 권한 설정이 완료되었습니다!"
echo ""
echo "다음 명령어로 봇을 실행하세요:"
echo "  python3 run.py"
echo ""

