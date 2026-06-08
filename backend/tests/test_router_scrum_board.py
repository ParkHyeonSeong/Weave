from routers import scrum_board as scrum_router
from library.validator import require_login


def _paths():
    return {(tuple(sorted(r.methods)), r.path) for r in scrum_router.router.routes}


def test_board_routes_registered():
    paths = _paths()
    assert (("POST",), "") in paths
    assert (("GET",), "") in paths
    assert (("GET",), "/{board_id:int}") in paths
    assert (("PATCH",), "/{board_id:int}") in paths
    assert (("DELETE",), "/{board_id:int}") in paths


def test_member_routes_registered():
    paths = _paths()
    assert (("GET",), "/{board_id}/members") in paths
    assert (("POST",), "/{board_id}/members") in paths
    assert (("PATCH",), "/{board_id}/members/{user_id}") in paths
    assert (("DELETE",), "/{board_id}/members/{user_id}") in paths


def test_every_route_requires_login():
    """인증은 이 레이어의 핵심 불변식 — 모든 라우트가 require_login을 달고 있어야 함."""
    for r in scrum_router.router.routes:
        deps = [d.dependency for d in getattr(r, "dependencies", [])]
        assert require_login in deps, f"{r.path} is missing require_login"
