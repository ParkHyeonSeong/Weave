from pydantic import BaseModel, Field

VALID_ROWS = ('plan', 'gap')
VALID_RETRO_KEYS = ('keep', 'problem', 'try')
VALID_MODES = ('replace', 'append')

# 셀 1회 쓰기당 텍스트 상한. 데일리스크럼/회고 셀은 짧은 메모이므로 canvas 페이지(300k)보다
# 작게 잡아, 멤버 인증된 PATCH로 거대한 텍스트를 Yjs 셀에 박아넣는 자원소모(DoS)를 막는다.
MAX_CELL_LENGTH = 10_000


class WeekCellWrite(BaseModel):
    day: int = Field(ge=0, le=4)                          # 0=월 .. 4=금
    row: str                                             # 'plan' | 'gap'
    text: str = Field(default="", max_length=MAX_CELL_LENGTH)
    mode: str = "replace"                                # 'replace' | 'append'


class RetroCellWrite(BaseModel):
    key: str                                             # 'keep' | 'problem' | 'try'
    text: str = Field(default="", max_length=MAX_CELL_LENGTH)
    mode: str = "replace"
