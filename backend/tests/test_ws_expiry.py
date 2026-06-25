import asyncio
import time

from library.ws_manager import schedule_token_expiry_close


class _FakeWS:
    def __init__(self):
        self.closed_with = None

    async def close(self, code=1000, reason=None):
        self.closed_with = code


async def test_no_exp_returns_none():
    assert schedule_token_expiry_close(_FakeWS(), {}) is None


async def test_closes_at_exp_with_code():
    ws = _FakeWS()
    # skew_secs=0으로 마진을 빼서 타이밍을 결정적으로(테스트는 close/cancel 로직만 검증)
    task = schedule_token_expiry_close(ws, {'exp': time.time() + 0.05}, code=4002, skew_secs=0)
    assert task is not None
    await asyncio.sleep(0.15)
    assert ws.closed_with == 4002


async def test_cancel_prevents_close():
    ws = _FakeWS()
    task = schedule_token_expiry_close(ws, {'exp': time.time() + 0.3}, skew_secs=0)
    task.cancel()
    await asyncio.sleep(0.05)
    assert ws.closed_with is None


async def test_skew_closes_before_exp():
    ws = _FakeWS()
    # exp 0.5s 후, skew 0.4s → 약 0.1s 뒤 닫힘(만료 전 선제)
    schedule_token_expiry_close(ws, {'exp': time.time() + 0.5}, skew_secs=0.4)
    await asyncio.sleep(0.03)
    assert ws.closed_with is None      # 아직(delay ~0.1)
    await asyncio.sleep(0.20)
    assert ws.closed_with == 4002
