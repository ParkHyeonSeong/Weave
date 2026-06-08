import re

from pycrdt import Doc, XmlFragment

# 칩(인라인 참조/멘션) 노드 — TipTap 노드명과 일치 (taskRef/docRef/mention).
# issueRef는 현재 셀 에디터엔 없지만 방어적으로 포함.
_CHIP_RE = re.compile(r'<\s*(taskRef|docRef|issueRef|mention)\b', re.I)
_TAG_RE = re.compile(r'<[^>]*>')


def cell_has_content(yjs_state: bytes | None, fragment_key: str) -> bool:
    """주(週) yjs_state에서 fragment_key 셀에 실제 입력이 있는지.

    빈 문단만 있으면 False. 텍스트 또는 인라인 참조/멘션 칩 노드가 있으면 True.

    pycrdt 직렬화 보정(board 1 week_id=1 실데이터 기준):
      - 작성된 셀  '1:0:plan' -> '<paragraph>로그인 버그 수정</paragraph>'  → True
      - 빈 셀      '1:3:plan' -> ''                                       → False
      - 칩만 있는 셀          -> '<paragraph><taskRef taskId="..."></taskRef></paragraph>' → True
    """
    if not yjs_state:
        return False
    doc = Doc()
    try:
        doc.apply_update(yjs_state)
    except Exception:
        return False
    frag = doc.get(fragment_key, type=XmlFragment)
    s = str(frag)
    # 태그 제거 후 텍스트가 남으면 내용 있음
    if _TAG_RE.sub('', s).strip():
        return True
    # 칩 노드(taskRef/docRef/issueRef/mention)만 있는 경우도 '작성됨'으로
    return bool(_CHIP_RE.search(s))
