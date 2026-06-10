# 사용자 아바타 색 헬퍼 — frontend/library/userAvatar.js 와 팔레트·해시 규칙 동기 유지.
# (수정 시 양쪽을 함께 바꿀 것)

AVATAR_COLORS = [
    '#5E6AD2',  # indigo
    '#059669',  # emerald-600
    '#B45309',  # amber-700
    '#9333EA',  # purple
    '#BE185D',  # pink-700
    '#0369A1',  # sky-700
    '#DC2626',  # red
    '#0D9488',  # teal-600
    '#A16207',  # yellow-800
    '#7C3AED',  # violet-600
    '#DB2777',  # pink-600
    '#475569',  # slate-600
]

NEUTRAL_COLOR = '#9CA3AF'


def user_color(user_id, override=None) -> str:
    """user_id를 안정적인 아바타 배경색으로 매핑. 사용자가 고른 색(override)이 팔레트에 있으면 우선."""
    if override and override in AVATAR_COLORS:
        return override
    if user_id is None:
        return NEUTRAL_COLOR
    return AVATAR_COLORS[abs(int(user_id)) % len(AVATAR_COLORS)]
