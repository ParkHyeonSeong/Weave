"""통합 ui_prefs(per-user 뷰 상태) 모델 테스트."""
from sqlalchemy import text

from core.model import user as user_model


async def _make_user(db, email):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": "u"})
    return row.scalar_one()


async def test_ui_prefs_roundtrip_and_namespace_merge(db_session):
    uid = await _make_user(db_session, "uiprefs1@test.local")
    assert await user_model.get_ui_prefs(uid, db_session) is None

    # sidebar_order 저장
    await user_model.update_ui_prefs(uid, {"sidebar_order": {"branches": [3, 1, 2]}}, db_session)
    got = await user_model.get_ui_prefs(uid, db_session)
    assert got["sidebar_order"]["branches"] == [3, 1, 2]

    # hidden만 PATCH해도 sidebar_order 보존(DB 원자적 top-level 병합)
    await user_model.update_ui_prefs(uid, {"hidden": {"branches": [2]}}, db_session)
    got2 = await user_model.get_ui_prefs(uid, db_session)
    assert got2["sidebar_order"]["branches"] == [3, 1, 2]
    assert got2["hidden"]["branches"] == [2]


def test_update_ui_prefs_schema_allows_home_controls():
    from routers.schema.profile import UpdateUiPrefs
    body = UpdateUiPrefs(home_controls={"branch": {"sort": "progress", "view": "list"}})
    patch = body.model_dump(exclude_none=True)
    assert patch == {"home_controls": {"branch": {"sort": "progress", "view": "list"}}}


def test_update_ui_prefs_schema_allows_saved_view_pins():
    from routers.schema.profile import UpdateUiPrefs
    body = UpdateUiPrefs(saved_view_pins={"7": [1, 2], "global": [5]})
    patch = body.model_dump(exclude_none=True)
    assert patch == {"saved_view_pins": {"7": [1, 2], "global": [5]}}


async def test_ui_prefs_saved_view_pins_merge(db_session):
    uid = await _make_user(db_session, "uiprefs_pins@test.local")
    await user_model.update_ui_prefs(uid, {"sidebar_order": {"branches": [1]}}, db_session)
    await user_model.update_ui_prefs(uid, {"saved_view_pins": {"7": [1, 2]}}, db_session)
    got = await user_model.get_ui_prefs(uid, db_session)
    assert got["saved_view_pins"]["7"] == [1, 2]
    assert got["sidebar_order"]["branches"] == [1]  # 기존 네임스페이스 보존
