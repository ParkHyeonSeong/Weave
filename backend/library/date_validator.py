from datetime import date


def is_valid_date_order(start: date | None, end: date | None) -> bool:
    """시작일 <= 종료일이면 True.

    한쪽이라도 None이면 비교 불가로 보고 허용(True).
    같은 날(start == end)도 허용(1일 기간).
    """
    if start is None or end is None:
        return True
    return start <= end
