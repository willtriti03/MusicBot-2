"""
음성 명령 처리 모듈
텍스트로 입력된 음성 명령어를 파싱하고 처리합니다.
"""

import os
import logging
from typing import Optional, Tuple

log = logging.getLogger(__name__)


class VoiceCommandParser:
    """
    음성 명령어를 파싱하는 클래스
    """

    def __init__(self, bot_name: str = "뮤직봇"):
        """
        Args:
            bot_name: 봇 이름 (음성으로 부를 이름)
        """
        self.bot_name = bot_name.lower()
        log.info(f"VoiceCommandParser initialized with bot_name: {bot_name}")

        # 명령어 매핑 (한국어 -> 영어 명령어)
        self.command_map = {
            # 재생 관련
            "재생": "!play",
            "플레이": "!play",
            "틀어줘": "play",
            "들려줘": "play",
            "노래틀어줘": "play",
            "음악틀어줘": "play",

            # 일시정지
            "일시정지": "!pause",
            "멈춰": "!pause",
            "정지": "!pause",
            "멈춰줘": "!pause",

            # 재개
            "다시재생": "!resume",
            "계속": "!resume",
            "다시": "!resume",
            "계속재생": "!resume",
            "이어서": "!resume",

            # 스킵
            "스킵": "!skip",
            "건너뛰기": "!skip",
            "넘겨": "!skip",
            "다음": "!skip",
            "다음곡": "!skip",
            "넘겨줘": "!skip",

            # 큐/대기열
            "큐": "!queue",
            "대기열": "!queue",
            "목록": "!queue",
            "재생목록": "!queue",

            # 현재 재생 중
            "지금재생": "!np",
            "현재곡": "!np",
            "지금곡": "np",
            "뭐나와": "!np",
            "뭐틀고있어": "!np",

            # 볼륨
            "볼륨": "!volume",
            "음량": "!volume",
            "소리": "!volume",
            "크기": "!volume",

            # 셔플
            "셔플": "!shuffle",
            "섞기": "!shuffle",
            "랜덤": "!shuffle",

            # 반복
            "반복": "!repeat",
            "리피트": "!repeat",
            "무한반복": "!repeat",

            # 종료
            "나와": "!disconnect",
            "종료": "!disconnect",
            "끊어": "!disconnect",
            "그만": "!disconnect",
            "나가": "!disconnect",
            "꺼져": "!disconnect",

            # 소환
            "와": "summon",
            "이리와": "summon",
            "오": "summon",
            "소환": "summon",

            # 클리어
            "클리어": "!clear",
            "전부삭제": "!clear",
            "다지워": "!clear",
            "목록지워": "!clear",
        }

    def is_voice_command(self, text: str) -> bool:
        """
        메시지가 음성 명령어인지 확인합니다.

        Args:
            text: 확인할 텍스트

        Returns:
            음성 명령어 여부
        """
        if not text:
            return False

        text = text.lower().strip()
        return self.bot_name in text

    def parse_command(self, text: str) -> Optional[Tuple[str, str]]:
        """
        텍스트에서 봇 이름과 명령어를 파싱합니다.

        Args:
            text: 파싱할 텍스트

        Returns:
            (명령어, 인자) 튜플 또는 None
        """
        if not text:
            return None

        text = text.lower().strip()

        # 봇 이름이 포함되어 있는지 확인
        if self.bot_name not in text:
            return None

        # 봇 이름 이후의 텍스트 추출
        bot_name_index = text.find(self.bot_name)
        command_text = text[bot_name_index + len(self.bot_name):].strip()

        if not command_text:
            return None

        # 명령어 찾기 (가장 긴 매칭을 우선)
        matched_command = None
        matched_korean_cmd = ""

        for korean_cmd, english_cmd in sorted(
            self.command_map.items(),
            key=lambda x: len(x[0]),
            reverse=True
        ):
            if command_text.startswith(korean_cmd):
                matched_command = english_cmd
                matched_korean_cmd = korean_cmd
                break

        if not matched_command:
            log.debug(f"No matching command found for: {command_text}")
            return None

        # 명령어 이후의 텍스트를 인자로 사용
        args = command_text[len(matched_korean_cmd):].strip()

        log.info(f"Parsed voice command: {matched_command} with args: {args}")
        return (matched_command, args)

    def get_command_prefix(self) -> str:
        """명령어 접두사 예시를 반환합니다."""
        return f"{self.bot_name} "


def load_bot_name_from_env() -> str:
    """
    .env 파일 또는 환경 변수에서 봇 이름을 로드합니다.

    Returns:
        봇 이름 (기본값: "뮤직봇")
    """
    try:
        from dotenv import load_dotenv
        # .env 파일 로드
        load_dotenv()
    except ImportError:
        log.warning("python-dotenv is not installed. Using environment variables only.")

    # BOT_NAME 환경 변수 가져오기
    bot_name = os.getenv("BOT_NAME", "뮤직봇")
    log.info(f"Loaded bot name from environment: {bot_name}")

    return bot_name
