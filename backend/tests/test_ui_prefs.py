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
