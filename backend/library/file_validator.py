"""파일 매직 바이트 검증 -- 이미지 위변조 방지"""

# 이미지 포맷별 매직 바이트 시그니처
_IMAGE_SIGNATURES = {
    '.jpg':  [b'\xFF\xD8\xFF'],
    '.jpeg': [b'\xFF\xD8\xFF'],
    '.png':  [b'\x89PNG\r\n\x1a\n'],
    '.gif':  [b'GIF87a', b'GIF89a'],
    '.webp': [b'RIFF'],
}


def _looks_like_svg(content: bytes) -> bool:
    """SVG는 텍스트라 magic byte가 없음 — BOM/공백 제거 후 '<?xml' 또는 '<svg' 시작인지 확인."""
    # UTF-8 BOM 제거
    stripped = content.lstrip(b'\xef\xbb\xbf').lstrip()
    head = stripped[:5].lower()
    return head.startswith(b'<?xml') or head.startswith(b'<svg')


def validate_image_magic_bytes(content: bytes, extension: str) -> bool:
    """
    파일 내용의 매직 바이트가 확장자와 일치하는지 검증.
    extension: '.jpg', '.png' 등 점(.) 포함 소문자.
    """
    if not content:
        return False

    if extension == '.svg':
        return _looks_like_svg(content)

    if len(content) < 12:
        return False

    sigs = _IMAGE_SIGNATURES.get(extension)
    if not sigs:
        return False

    for sig in sigs:
        if content[:len(sig)] == sig:
            # WebP 추가 검증: offset 8-12가 'WEBP'여야 함
            if extension == '.webp':
                return content[8:12] == b'WEBP'
            return True

    return False
