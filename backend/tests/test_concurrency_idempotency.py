"""클러스터 K(정합성): 동시 중복 요청 멱등성(LOG-17/19/20) + 결정적 정렬 tiebreaker.

데이터 중복은 PK/UNIQUE 제약이 이미 막는다. 여기서 검증하는 것은 (1) 중복 요청이 500
대신 멱등하게 처리되는지, (2) 정렬 컬럼(sort_order/position) 동률 시 표시 순서가
결정적인지(유니크 PK 최종 tiebreaker)이다.
"""
from sqlalchemy import text

from core.model import task as task_model
from core.model import branch_member, canvas_member, star


async def _make_user(db, email, username="u"):
    row = await db.execute(text(
        """INSERT INTO "user"(email,password,username,status)
           VALUES(:e,:p,:u,'active') RETURNING user_id"""),
        {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, key):
    row = await db.execute(text(
        """INSERT INTO branch(branch_name,key,description,visibility,color,created_by)
           VALUES('B',:k,'d','private','#5E6AD2',:u) RETURNING branch_id"""),
        {"k": key, "u": created_by})
    bid = row.scalar_one()
    await db.execute(text(
        """INSERT INTO workflow_status(branch_id,key,label,color,category,sort_order)
           VALUES(:b,'todo','To Do','#9CA3AF','todo',0)"""), {"b": bid})
    return bid


async def _make_canvas(db, branch_id, created_by, key):
    row = await db.execute(text(
        """INSERT INTO canvas(branch_id,canvas_name,key,visibility,created_by)
           VALUES(:b,'C',:k,'private',:u) RETURNING canvas_id"""),
        {"b": branch_id, "k": key, "u": created_by})
    return row.scalar_one()


# ── LOG-17: task 번호 시퀀스(행 없는 브랜치 첫 task부터 단일 upsert로 직렬 증가) ──

async def test_next_display_number_legacy_no_row(db_session):
    # task_sequence 행이 없는 레거시 브랜치: 첫 호출이 INSERT(1), 이후 ON CONFLICT로 +1
    u = await _make_user(db_session, "k1@t.local")
    b = await _make_branch(db_session, u, "KSEQ")
    nums = [await task_model.next_display_number(b, db_session) for _ in range(3)]
    assert nums == [1, 2, 3]


async def test_next_display_number_new_branch_with_zero_row(db_session):
    # 정상 신규 브랜치 경로: 생성 시 task_sequence(branch_id, 0)가 선삽입됨(branch.create와 동일)
    u = await _make_user(db_session, "k1b@t.local")
    b = await _make_branch(db_session, u, "KSEQ2")
    await db_session.execute(text(
        "INSERT INTO task_sequence (branch_id, last_number) VALUES (:b, 0)"), {"b": b})
    nums = [await task_model.next_display_number(b, db_session) for _ in range(3)]
    assert nums == [1, 2, 3]


# ── LOG-20: 멤버 추가 멱등(재추가 시 500 없이 role 갱신, 행은 하나) ──

async def test_branch_member_add_idempotent(db_session):
    u = await _make_user(db_session, "k2@t.local")
    b = await _make_branch(db_session, u, "KBM")
    await branch_member.add(b, u, 'member', db_session)
    # 재추가는 500 없이 멱등 — DO NOTHING이라 기존 role을 덮어쓰지 않는다(역할 변경은 update_role)
    await branch_member.add(b, u, 'admin', db_session)
    assert await branch_member.get_role(b, u, db_session) == 'member'
    cnt = (await db_session.execute(text(
        "SELECT COUNT(*) FROM branch_member WHERE branch_id=:b AND user_id=:u"),
        {"b": b, "u": u})).scalar_one()
    assert cnt == 1


async def test_canvas_member_add_idempotent(db_session):
    u = await _make_user(db_session, "k3@t.local")
    b = await _make_branch(db_session, u, "KCM")
    cv = await _make_canvas(db_session, b, u, "KCMC")
    await canvas_member.add(cv, u, 'member', db_session)
    await canvas_member.add(cv, u, 'admin', db_session)
    assert await canvas_member.get_role(cv, u, db_session) == 'member'
    cnt = (await db_session.execute(text(
        "SELECT COUNT(*) FROM canvas_member WHERE canvas_id=:c AND user_id=:u"),
        {"c": cv, "u": u})).scalar_one()
    assert cnt == 1


# ── LOG-19: star 토글 라운드트립(정상 경로 회귀) + 중복 INSERT 멱등 ──

async def test_star_toggle_round_trip_and_idempotent(db_session):
    u = await _make_user(db_session, "k4@t.local")
    assert await star.toggle(u, 'task', 99999, db_session) == {'starred': True}
    assert await star.toggle(u, 'task', 99999, db_session) == {'starred': False}
    assert await star.toggle(u, 'task', 99999, db_session) == {'starred': True}
    # 동시 중복 별표 시뮬레이션: 이미 있는 상태에서 INSERT 재실행 → ON CONFLICT DO NOTHING(500 없음)
    await db_session.execute(text(
        """INSERT INTO user_star(user_id,item_type,item_id) VALUES(:u,'task',99999)
           ON CONFLICT (user_id,item_type,item_id) DO NOTHING"""), {"u": u})


# ── K-2: sort_order 동률 시 결정적 순서(유니크 task_id 최종 tiebreaker) ──

async def test_task_order_deterministic_on_sort_order_tie(db_session):
    u = await _make_user(db_session, "k5@t.local")
    b = await _make_branch(db_session, u, "KORD")
    # sort_order·created_at가 완전히 동일한 두 task를 직접 삽입(동시 생성 시뮬레이션).
    # tiebreaker가 없으면 표시 순서가 비결정적 — task_id로 결정적이어야 한다.
    ids = []
    for _ in range(2):
        dn = await task_model.next_display_number(b, db_session)
        row = await db_session.execute(text(
            """INSERT INTO task(branch_id,display_number,title,created_by,sort_order,created_at)
               VALUES(:b,:dn,'T',:u,0,'2020-01-01 00:00:00+00') RETURNING task_id"""),
            {"b": b, "dn": dn, "u": u})
        ids.append(row.scalar_one())
    tasks = await task_model.find_by_branch(b, None, db_session)
    got = [t['task_id'] for t in tasks if t['task_id'] in ids]
    assert got == sorted(ids)
