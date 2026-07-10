"""GET 쿼리 params용 format 인자 조립 — 읽기 4도구(get_task/list_task_comments/
get_task_issue/get_canvas_page) 공용. format="html"(기본값)은 쿼리 생략, 그
외에만 포함한다(egress 쿼리 전달, backend Literal 기본값과 대칭)."""


def format_params(format: str, **base) -> dict:
    params = dict(base)
    if format != "html":
        params["format"] = format
    return params
