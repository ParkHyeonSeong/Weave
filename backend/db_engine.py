from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from config import DATABASE_URL, DB_STATEMENT_TIMEOUT_MS

# 모든 쿼리에 statement_timeout(ms)을 강제해, 재귀 의존성 검사 등 병리적 쿼리가 커넥션을
# 무한 점유하지 못하게 한다(SEC-33). asyncpg는 server_settings로 GUC를 전달한다.
_connect_args = {}
if DB_STATEMENT_TIMEOUT_MS > 0:
    _connect_args["server_settings"] = {"statement_timeout": str(DB_STATEMENT_TIMEOUT_MS)}

engine = create_async_engine(
    DATABASE_URL,
    pool_size=5,
    max_overflow=10,
    pool_recycle=3600,
    pool_pre_ping=True,
    connect_args=_connect_args,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def session():
    """HTTP route용 - 요청 성공 시 auto-commit, 실패 시 rollback"""
    async with AsyncSessionLocal() as db:
        try:
            yield db
            await db.commit()
        except Exception:
            await db.rollback()
            raise


@asynccontextmanager
async def transactional_session():
    """WebSocket/백그라운드 태스크용 - 블록 성공 시 auto-commit, 실패 시 rollback"""
    async with AsyncSessionLocal() as db:
        try:
            yield db
            await db.commit()
        except Exception:
            await db.rollback()
            raise
