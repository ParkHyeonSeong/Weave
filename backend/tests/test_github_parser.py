from library.github_parser import extract_refs


def test_extract_single_ref_from_title():
    assert extract_refs("Fix login WV-123 crash") == [("WV", 123)]


def test_extract_from_branch_name():
    assert extract_refs("feature/WV-7-add-oauth") == [("WV", 7)]


def test_lowercase_is_normalized_to_upper():
    assert extract_refs("fixes wv-42") == [("WV", 42)]


def test_multi_ref_dedup_order_preserved():
    text = "WV-1 and AB12-9, again WV-1 plus wv-1"
    assert extract_refs(text) == [("WV", 1), ("AB12", 9)]


def test_no_ref_returns_empty():
    assert extract_refs("just a plain commit message") == []


def test_none_and_empty_return_empty():
    assert extract_refs(None) == []
    assert extract_refs("") == []


def test_key_min_two_chars_and_must_start_alpha():
    # single-letter key (A-1) is NOT a branch key (needs 2..10 chars) -> no match
    assert extract_refs("A-1 is not a key") == []
    # digit-leading token is not a key
    assert extract_refs("9X-3 nope") == []


def test_key_max_ten_chars():
    # 10-char key matches; 11-char does not
    assert extract_refs("ABCDEFGHIJ-5") == [("ABCDEFGHIJ", 5)]
    assert extract_refs("ABCDEFGHIJK-5") == []
