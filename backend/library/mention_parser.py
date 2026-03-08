import re


def extract_mention_user_ids(html: str) -> list[int]:
    """HTML에서 data-user-id 속성을 가진 mention span의 userId 추출"""
    if not html or not isinstance(html, str):
        return []

    return list({
        int(uid)
        for uid in re.findall(r'data-user-id="(\d+)"', html)
    })
