from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Request

from library.validator import require_login
from routers.schema.url_meta import URLMetaRequest

router = APIRouter()

MAX_BODY_SIZE = 100 * 1024  # 100KB


@router.post('')
async def fetch_url_meta(req: Request, body: URLMetaRequest):
    """URL 메타데이터 추출 (title, description, favicon, og:image)"""
    require_login(req)

    try:
        async with httpx.AsyncClient(
            timeout=5.0,
            follow_redirects=True,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; Weave/1.0)'},
        ) as client:
            resp = await client.get(body.url)

        content_type = resp.headers.get('content-type', '')
        if 'text/html' not in content_type:
            return {'status': False, 'message': 'Not an HTML page'}

        html = resp.text[:MAX_BODY_SIZE]
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
