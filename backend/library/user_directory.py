"""사용자 디렉터리/멤버 목록 응답 위생 헬퍼."""


def strip_email(rows):
    """사용자 dict 리스트에서 email 필드를 제거한다.

    멘션·메신저 디렉터리·비멤버에게 보이는 멤버 목록처럼 이메일을 노출할 필요가 없는
    응답에 사용한다(SEC-09 / SEC-21 / SEC-37). 입력을 변형하지 않고 새 리스트를 반환한다.
    """
    return [{k: v for k, v in row.items() if k != 'email'} for row in rows]
