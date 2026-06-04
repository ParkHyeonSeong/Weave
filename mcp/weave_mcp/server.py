from ._app import mcp
from . import tools  # noqa: F401  -- importing registers all @mcp.tool functions


def main() -> None:
    """Console-script / module entrypoint. Runs over stdio by default."""
    mcp.run()


if __name__ == "__main__":
    main()
