import pytest
from pydantic import ValidationError

from routers.schema import scrum_board as s


def test_board_create_defaults():
    m = s.ScrumBoardCreate(name="팀A")
    assert m.visibility == "private"
    assert m.retro_cadence == "weekly"
    assert m.retro_template == "kpt"
    assert m.retro_anchor_weekday == 4


def test_board_create_rejects_blank_name():
    with pytest.raises(ValidationError):
        s.ScrumBoardCreate(name="   ")


def test_board_create_rejects_bad_cadence():
    with pytest.raises(ValidationError):
        s.ScrumBoardCreate(name="팀", retro_cadence="yearly")


def test_board_create_rejects_bad_weekday():
    with pytest.raises(ValidationError):
        s.ScrumBoardCreate(name="팀", retro_anchor_weekday=9)


def test_member_add_rejects_bad_role():
    with pytest.raises(ValidationError):
        s.ScrumMemberAdd(user_id=1, role="owner")


def test_member_add_valid():
    m = s.ScrumMemberAdd(user_id=7)
    assert m.role == "member"
