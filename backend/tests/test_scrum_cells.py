from pycrdt import Doc, XmlElement, XmlFragment, XmlText

from library.scrum_cells import cell_has_content, read_cells, write_cell_into_doc

KEY = "7:2:plan"


def _written_update(key: str = KEY, text: str = "done") -> bytes:
    """key 셀에 <paragraph>text</paragraph> 를 쓴 doc 업데이트."""
    doc = Doc()
    with doc.transaction():
        frag = doc.get(key, type=XmlFragment)
        para = XmlElement("paragraph")
        frag.children.append(para)
        para.children.append(XmlText(text))
    return doc.get_update()


def _chip_update(key: str = KEY) -> bytes:
    """key 셀에 칩(taskRef) 노드만 있는 빈 문단을 쓴 doc 업데이트."""
    doc = Doc()
    with doc.transaction():
        frag = doc.get(key, type=XmlFragment)
        para = XmlElement("paragraph")
        frag.children.append(para)
        ref = XmlElement("taskRef")
        para.children.append(ref)
        ref.attributes["taskId"] = "123"
    return doc.get_update()


def test_written_cell_has_content():
    assert cell_has_content(_written_update(), KEY) is True


def test_empty_cell_no_content():
    # 같은 doc에서 다른(미작성) 셀은 비어 있음.
    state = _written_update(KEY, "hi")
    assert cell_has_content(state, "7:3:plan") is False


def test_chip_only_cell_has_content():
    # 칩(taskRef)만 있고 텍스트가 없어도 '작성됨'.
    assert cell_has_content(_chip_update(), KEY) is True


def test_none_state_is_false():
    assert cell_has_content(None, KEY) is False
    assert cell_has_content(b"", KEY) is False


def test_malformed_state_is_false():
    assert cell_has_content(b"\x00\x01\x02not-a-yjs-update", KEY) is False


def _roundtrip(text, mode="replace", initial=None):
    doc = Doc()
    if initial is not None:
        doc.apply_update(initial)
    write_cell_into_doc(doc, KEY, text, mode)
    return doc.get_update()


def test_write_replace_single_line_roundtrips():
    state = _roundtrip("로그인 버그 수정")
    assert read_cells(state, [KEY])[KEY] == "로그인 버그 수정"


def test_write_is_frontend_compatible():
    # 프론트 호환: cell_has_content가 새로 쓴 셀을 작성됨으로 인식
    state = _roundtrip("작업 완료")
    assert cell_has_content(state, KEY) is True


def test_write_multiline_becomes_paragraphs():
    state = _roundtrip("첫 줄\n둘째 줄")
    assert read_cells(state, [KEY])[KEY] == "첫 줄\n둘째 줄"


def test_write_replace_overwrites_existing():
    first = _roundtrip("old")
    state = _roundtrip("new", mode="replace", initial=first)
    assert read_cells(state, [KEY])[KEY] == "new"


def test_write_append_keeps_existing():
    first = _roundtrip("old")
    state = _roundtrip("added", mode="append", initial=first)
    assert read_cells(state, [KEY])[KEY] == "old\nadded"


def test_write_replace_empty_clears_cell():
    first = _roundtrip("something")
    state = _roundtrip("", mode="replace", initial=first)
    assert read_cells(state, [KEY])[KEY] == ""
    assert cell_has_content(state, KEY) is False


def test_read_cells_missing_key_is_empty_string():
    state = _roundtrip("hi")
    out = read_cells(state, [KEY, "7:9:plan"])
    assert out["7:9:plan"] == ""


def test_read_cells_none_state_all_empty():
    assert read_cells(None, [KEY]) == {KEY: ""}


def test_write_read_preserves_angle_brackets():
    # 정규식 태그 스트립이면 'List<String>'의 '<String>'이 잘림 — 구조적 순회로 보존돼야 함
    for raw in ("List<String>", "a < b and c > d", "Map<K, V>", "if x > 0 && y < 9"):
        state = _roundtrip(raw)
        assert read_cells(state, [KEY])[KEY] == raw


def test_read_cell_skips_chip_keeps_surrounding_text():
    # 칩(taskRef) 노드는 무시하되 같은 문단의 텍스트는 보존
    doc = Doc()
    with doc.transaction():
        frag = doc.get(KEY, type=XmlFragment)
        para = XmlElement("paragraph")
        frag.children.append(para)
        para.children.append(XmlText("before "))
        ref = XmlElement("taskRef")
        para.children.append(ref)
        ref.attributes["taskId"] = "9"
        para.children.append(XmlText("after"))
    assert read_cells(doc.get_update(), [KEY])[KEY] == "before after"
