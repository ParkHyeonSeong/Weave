from routers import ws_scrum as ws_router
from routers import scrum_week as week_router
from library.validator import require_login


def test_ws_scrum_route_registered():
    paths = {r.path for r in ws_router.router.routes}
    assert "/ws/scrum/{board_id}/weeks/{week_id}" in paths


def test_week_rest_route_registered_and_authed():
    routes = list(week_router.router.routes)
    paths = {r.path for r in routes}
    assert "/{board_id}/weeks/{iso_year}/{iso_week}" in paths
    for r in routes:
        deps = [d.dependency for d in getattr(r, "dependencies", [])]
        assert require_login in deps
