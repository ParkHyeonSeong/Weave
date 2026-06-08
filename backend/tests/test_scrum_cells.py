from pycrdt import Doc, XmlElement, XmlFragment, XmlText

from library.scrum_cells import cell_has_content

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
