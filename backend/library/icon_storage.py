"""Entity icon 이미지 파일 저장/삭제 공용 헬퍼.

icon 컬럼은 'image:/api/uploads/<entity>-icons/<filename>' 형태로 저장된다.
업로드 / 변경 / 삭제 시 디스크 정합성을 같은 코드에서 처리해 누수와 path traversal을
한 곳에서 막는다.
"""
import os


def delete_image_icon_file(old_icon_value: str | None, upload_dir: str) -> None:
    """`image:` prefix가 붙은 icon 값이 가리키는 파일을 디스크에서 삭제.

    - upload_dir 하위가 아닌 경로는 무시 (path traversal 방어).
    - 파일이 없거나 prefix가 아니면 조용히 통과.
    """
    if not old_icon_value or not old_icon_value.startswith('image:'):
        return

    rel = old_icon_value[len('image:'):].replace('/api/uploads/', 'uploads/').lstrip('/')
    # backend 디렉토리 = upload_dir의 2단계 상위 (uploads/<entity>-icons → 2 단계 위)
    backend_root = os.path.dirname(os.path.dirname(upload_dir))
    old_path = os.path.normpath(os.path.join(backend_root, rel))
    uploads_base = os.path.normpath(upload_dir)
    if old_path.startswith(uploads_base) and os.path.exists(old_path):
        os.remove(old_path)
