from routers import ws_scrum_retro as ws_router
from routers import scrum_retro as retro_router
from library.validator import require_login


def test_ws_scrum_retro_route_registered():
    paths = {r.path for r in ws_router.router.routes}
    assert "/ws/scrum/{board_id}/retros/{retro_id}" in paths


def test_retro_rest_routes_registered_and_authed():
    routes = list(retro_router.router.routes)
    paths = {r.path for r in routes}
    assert "/{board_id}/retros/current" in paths
    assert "/{board_id}/retros" in paths
    for r in routes:
        deps = [d.dependency for d in getattr(r, "dependencies", [])]
        assert require_login in deps


def test_retro_rest_route_ordering_current_before_list():
    # 정적 경로(/retros/current)가 동적 매칭(/retros)보다 먼저 선언되어야 한다.
    paths = [r.path for r in retro_router.router.routes]
    assert paths.index("/{board_id}/retros/current") < paths.index("/{board_id}/retros")
