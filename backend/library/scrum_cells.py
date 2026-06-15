import re

from pycrdt import Doc, XmlElement, XmlFragment, XmlText

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


def _node_text(node) -> str:
    """XmlText/XmlElement 노드의 텍스트를 재귀로 모은다.

    str(XmlFragment) 정규식 파싱은 쓰지 않는다 — pycrdt는 '<'/'>'를 HTML 이스케이프하지
    않아 'List<String>' 같은 사용자 텍스트가 가짜 태그로 잘려나가기 때문. 구조적 순회로
    XmlText 자손만 모으면 꺾쇠 텍스트가 보존된다. 칩(taskRef 등)은 텍스트가 없어 무시(v1 평문).
    """
    if isinstance(node, XmlText):
        return str(node)
    return "".join(_node_text(c) for c in node.children)


def read_cells(yjs_state: bytes | None, fragment_keys: list[str]) -> dict[str, str]:
    """주어진 fragment_key들의 셀 내용을 평문으로 읽는다.

    호출자가 키 목록을 넘긴다(pycrdt 키 열거에 의존하지 않음). 각 문단 경계는 '\n'.
    빈/부재 셀과 디코드 실패 셀은 ''. v1은 평문만 — taskRef/mention 칩은 텍스트가 없으면 ''.
    """
    out = {k: "" for k in fragment_keys}
    if not yjs_state:
        return out
    doc = Doc()
    try:
        doc.apply_update(yjs_state)
    except Exception:
        return out
    for k in fragment_keys:
        frag = doc.get(k, type=XmlFragment)
        out[k] = "\n".join(_node_text(child) for child in frag.children).strip()
    return out


def write_cell_into_doc(doc: Doc, fragment_key: str, text: str, mode: str = "replace") -> None:
    """fragment_key 셀에 평문 text를 쓴다. 각 줄이 <paragraph>가 된다 (프론트 TipTap 호환).

    mode='replace'(기본): 기존 children 삭제 후 작성. text=''이면 셀 비우기.
    mode='append': 기존 children 뒤에 문단 추가.
    """
    frag = doc.get(fragment_key, type=XmlFragment)
    with doc.transaction():
        if mode == "replace":
            while len(frag.children):
                del frag.children[0]
        if text == "":
            return
        for line in text.split("\n"):
            para = XmlElement("paragraph")
            frag.children.append(para)
            if line:
                para.children.append(XmlText(line))
