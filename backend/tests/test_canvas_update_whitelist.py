"""SEC-36: canvas.update가 컬럼명 화이트리스트로 임의 필드 주입을 차단한다.

필드명이 f-string으로 SQL에 보간되므로, 허용된 컬럼명만 통과시켜 mass-assignment/
컬럼명 주입을 모델 레벨에서 막는다(Pydantic 외 2차 방어).
"""
import bcrypt
from sqlalchemy import text

from core.model import canvas as canvas_model


async def _user(db):
    pw = bcrypt.hashpw(b'x', bcrypt.gensalt())
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, role)
        VALUES ('c36@t.local', :p, 'c36', 'active', 'member') RETURNING user_id
    """), {'p': pw})
    return row.scalar_one()


async def _branch(db, uid):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('B', 'C36B', 'd', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {'u': uid})
    return row.scalar_one()


async def _canvas(db, branch_id, uid):
    row = await db.execute(text("""
        INSERT INTO canvas (branch_id, canvas_name, key, visibility, created_by)
        VALUES (:b, 'Orig', 'C36C', 'private', :u) RETURNING canvas_id
    """), {'b': branch_id, 'u': uid})
    return row.scalar_one()


async def test_update_applies_allowed_fields(db_session):
    uid = await _user(db_session)
    cid = await _canvas(db_session, await _branch(db_session, uid), uid)
    await canvas_model.update(cid, {'canvas_name': 'NewName', 'color': '#111111'}, db_session)
    c = await canvas_model.find_by_id(cid, db_session)
    assert c['canvas_name'] == 'NewName'
    assert c['color'] == '#111111'


async def test_update_ignores_disallowed_fields(db_session):
    uid = await _user(db_session)
    cid = await _canvas(db_session, await _branch(db_session, uid), uid)
    # 허용 필드는 적용되고, 비허용(is_archived/created_by)은 무시돼야 한다
    await canvas_model.update(
        cid, {'canvas_name': 'X2', 'is_archived': True, 'created_by': 999}, db_session)
    c = await canvas_model.find_by_id(cid, db_session)  # is_archived=FALSE 행만 반환
    assert c is not None and c['canvas_name'] == 'X2'
    assert c['is_archived'] is False  # update로 변경되지 않음(화이트리스트 제외)


async def test_update_only_disallowed_is_noop(db_session):
    uid = await _user(db_session)
    cid = await _canvas(db_session, await _branch(db_session, uid), uid)
    # 컬럼명 주입 시도 + 비허용 키만 → 필터 후 빈 업데이트 → no-op(예외 없음)
    await canvas_model.update(
        cid, {'evil = 1, deleted_at': 'x', 'created_by': 1}, db_session)
    c = await canvas_model.find_by_id(cid, db_session)
    assert c is not None and c['canvas_name'] == 'Orig'  # 변경 없음
