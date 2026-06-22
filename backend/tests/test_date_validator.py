from datetime import date

from library.date_validator import is_valid_date_order


def test_none_is_allowed():
    assert is_valid_date_order(None, None) is True
    assert is_valid_date_order(date(2026, 1, 1), None) is True
    assert is_valid_date_order(None, date(2026, 1, 1)) is True


def test_equal_is_allowed():
    assert is_valid_date_order(date(2026, 6, 20), date(2026, 6, 20)) is True


def test_start_before_end_ok():
    assert is_valid_date_order(date(2026, 6, 18), date(2026, 6, 25)) is True


def test_start_after_end_rejected():
    assert is_valid_date_order(date(2026, 6, 25), date(2026, 6, 18)) is False
