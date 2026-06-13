"""SEC-17: 서버측 HTML 정화.

- 단위: sanitize_html이 정상 TipTap 출력은 보존하고 XSS 벡터만 제거하는지.
- 통합: canvas 페이지 create/update가 저장 전에 정화하는지(REST 경로).
"""
from types import SimpleNamespace

from sqlalchemy import text

from library.html_sanitize import sanitize_html
from core.controller import canvas_page as canvas_ctrl
from core.model import canvas_page as page_model
from routers.schema.canvas_page import CanvasPageUpdate


# ── 단위: sanitize_html ────────────────────────────────────────────────────

def test_preserves_tiptap_output():
    # 구조/data-*/class는 그대로 보존(style 없는 케이스는 정확히 일치)
    exact = [
        '<span data-type="mention" data-id="5" class="mention">@A</span>',
        '<img src="/api/uploads/canvas/c1_a.png" alt="i">',
        '<table><tbody><tr><th colspan="2">h</th></tr></tbody></table>',
        '<pre><code class="language-python">print(1)</code></pre>',
    ]
    for html in exact:
        assert sanitize_html(html) == html, f"정상 콘텐츠가 변경됨: {html}"
    # style은 화이트리스트 통과 후 정규화(공백 제거)되되 서식 값은 보존
    assert 'color:#e03131' in sanitize_html('<span style="color: #e03131">red</span>')
    assert 'background-color:#ffd43b' in sanitize_html('<mark style="background-color: #ffd43b">h</mark>')
    assert 'text-align:center' in sanitize_html('<p style="text-align: center">c</p>')


def test_strips_xss_vectors():
    assert sanitize_html('<script>alert(1)</script>') == ''
    assert 'onerror' not in sanitize_html('<img src=x onerror=alert(1)>')
    assert 'javascript:' not in sanitize_html('<a href="javascript:alert(1)">x</a>')
    assert sanitize_html('<iframe src="//evil"></iframe>') == ''
    assert 'onclick' not in sanitize_html('<div onclick="e()">x</div>')
    assert sanitize_html('<svg onload=alert(1)></svg>') == ''


def test_strips_css_url_fetch_and_layout():
    # url()을 가져오는 CSS 속성은 화이트리스트에 없어 제거 → 외부 요청/추적/exfiltration 차단
    assert 'url(' not in sanitize_html('<span style="background:url(javascript:alert(1))">x</span>')
    assert 'url(' not in sanitize_html('<div style="background-image:url(//evil/track.gif)">x</div>')
    assert 'behavior' not in sanitize_html('<a style="behavior:url(x.htc)">x</a>')
    # 레이아웃 오버레이(position:fixed 등)도 화이트리스트 밖 → 제거
    assert 'position' not in sanitize_html('<div style="position:fixed;top:0;color:red">x</div>')


def test_target_link_gets_rel():
    out = sanitize_html('<a href="https://x.com" target="_blank">x</a>')
    assert 'rel="noopener noreferrer"' in out


def test_none_and_empty_passthrough():
    assert sanitize_html(None) is None
    assert sanitize_html('') == ''


# ── 통합: canvas create/update 저장 정화 ───────────────────────────────────

def _req(uid):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': uid, 'username': 'u'}))


async def _user(db, email):
    row = await db.execute(text(
        """INSERT INTO "user"(email,password,username,status)
           VALUES(:e,:p,'u','active') RETURNING user_id"""), {"e": email, "p": b"x"})
    return row.scalar_one()


async def _canvas_with_member(db, uid, key):
    row = await db.execute(text(
        """INSERT INTO canvas(branch_id,canvas_name,key,visibility,created_by)
           VALUES(NULL,'C',:k,'private',:u) RETURNING canvas_id"""), {"k": key, "u": uid})
    cv = row.scalar_one()
    await db.execute(text(
        "INSERT INTO canvas_member(canvas_id,user_id,role) VALUES(:c,:u,'admin')"),
        {"c": cv, "u": uid})
    return cv


_XSS = '<p>hi</p><script>alert(1)</script><span data-id="9" class="mention">@A</span>'


async def test_create_sanitizes_stored_content(db_session):
    uid = await _user(db_session, 's17c@t.local')
    cv = await _canvas_with_member(db_session, uid, 'S17C')
    body = SimpleNamespace(title='T', content=_XSS, parent_page_id=None, type='doc')
    res = await canvas_ctrl.create(cv, body, _req(uid), db_session)
    assert res['status'] is True
    page = await page_model.find_by_id(res['page_id'], db_session)
    assert '<script>' not in page['content'] and 'alert(1)' not in page['content']
    assert 'data-id="9"' in page['content']  # 정상 멘션 보존


async def test_update_sanitizes_stored_content(db_session):
    uid = await _user(db_session, 's17u@t.local')
    cv = await _canvas_with_member(db_session, uid, 'S17U')
    create_body = SimpleNamespace(title='T', content='<p>x</p>', parent_page_id=None, type='doc')
    res = await canvas_ctrl.create(cv, create_body, _req(uid), db_session)
    pid = res['page_id']
    await canvas_ctrl.update(cv, pid, CanvasPageUpdate(content=_XSS), _req(uid), db_session)
    page = await page_model.find_by_id(pid, db_session)
    assert '<script>' not in page['content'] and 'alert(1)' not in page['content']
    assert 'data-id="9"' in page['content']
