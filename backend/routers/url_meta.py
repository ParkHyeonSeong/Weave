from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Request

from library.validator import require_login
from library.url_validator import resolve_validated_ip
from library.rate_limiter import limiter
from routers.schema.url_meta import URLMetaRequest

router = APIRouter()

MAX_BODY_SIZE = 100 * 1024  # 100KB


@router.post('')
@limiter.limit("10/minute")
async def fetch_url_meta(request: Request, body: URLMetaRequest):
    """URL 메타데이터 추출 (title, description, favicon, og:image)"""
    require_login(request)

    # SSRF 방지: 내부 네트워크/메타데이터 URL 차단 + 검증된 IP 확보(리바인딩 차단용)
    ip, ssrf_error = await resolve_validated_ip(body.url)
    if ssrf_error:
        return {'status': False, 'message': ssrf_error}

    try:
        async with httpx.AsyncClient(
            timeout=5.0,
            follow_redirects=False,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; Weave/1.0)'},
        ) as client:
            # 리다이렉트를 수동으로 따라가며 매 hop마다 SSRF 재검증.
            # 검증과 실제 연결 사이의 DNS 리바인딩(TOCTOU)을 막기 위해, 재해석에 맡기지 않고
            # 검증된 IP로 직접 연결한다(Host 헤더·TLS SNI는 원 hostname 유지).
            url = body.url
            resp = None
            for _ in range(4):  # 최초 요청 + 최대 3회 리다이렉트
                parsed = urlparse(url)
                port = parsed.port or (443 if parsed.scheme == 'https' else 80)
                ip_host = f'[{ip}]' if ':' in ip else ip
                pinned_url = f'{parsed.scheme}://{ip_host}:{port}{parsed.path or "/"}'
                if parsed.query:
                    pinned_url += f'?{parsed.query}'
                # Host는 비표준 포트일 때 포트를 포함해야 한다(HTTP/1.1). SNI는 포트 없는 hostname.
                host_header = parsed.hostname if port in (80, 443) else f'{parsed.hostname}:{port}'
                req = client.build_request(
                    'GET', pinned_url,
                    headers={'Host': host_header},
                    extensions={'sni_hostname': parsed.hostname},
                )
                resp = await client.send(req)
                if resp.is_redirect:
                    location = resp.headers.get('location', '')
                    if not location:
                        return {'status': False, 'message': 'Invalid redirect'}
                    url = urljoin(url, location)
                    ip, ssrf_error = await resolve_validated_ip(url)
                    if ssrf_error:
                        return {'status': False, 'message': ssrf_error}
                    continue
                break

        if resp.is_redirect:
            return {'status': False, 'message': 'Too many redirects'}

        content_type = resp.headers.get('content-type', '')
        if 'text/html' not in content_type:
            return {'status': False, 'message': 'Not an HTML page'}

        # MAX_BODY_SIZE는 바이트 한도 — resp.text(디코딩된 str)를 자르면 멀티바이트에서
        # 한도가 무력화되므로 raw 바이트를 먼저 자른 뒤 디코딩한다.
        html = resp.content[:MAX_BODY_SIZE].decode(resp.encoding or 'utf-8', errors='replace')
        soup = BeautifulSoup(html, 'html.parser')

        # title
        og_title = soup.find('meta', property='og:title')
        title = og_title['content'] if og_title and og_title.get('content') else None
        if not title:
            title_tag = soup.find('title')
            title = title_tag.get_text(strip=True) if title_tag else None

        # description
        og_desc = soup.find('meta', property='og:description')
        description = og_desc['content'] if og_desc and og_desc.get('content') else None
        if not description:
            meta_desc = soup.find('meta', attrs={'name': 'description'})
            description = meta_desc['content'] if meta_desc and meta_desc.get('content') else None

        # og:image
        og_image_tag = soup.find('meta', property='og:image')
        og_image = og_image_tag['content'] if og_image_tag and og_image_tag.get('content') else None
        if og_image and not og_image.startswith('http'):
            og_image = urljoin(body.url, og_image)

        # favicon
        favicon = None
        icon_link = soup.find('link', rel=lambda v: v and 'icon' in v)
        if icon_link and icon_link.get('href'):
            favicon = icon_link['href']
            if not favicon.startswith('http'):
                favicon = urljoin(body.url, favicon)
        if not favicon:
            parsed = urlparse(body.url)
            favicon = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"

        # domain
        domain = urlparse(body.url).netloc

        return {
            'status': True,
            'meta': {
                'title': title or domain,
                'description': description or '',
                'favicon': favicon,
                'og_image': og_image,
                'domain': domain,
            },
        }

    except Exception:
        return {'status': False, 'message': 'Failed to fetch URL metadata'}
