import json, pathlib, pytest
from core.query.eval_inmem import evaluate
CASES = json.loads((pathlib.Path(__file__).parent / "fixtures" / "filter_parity_cases.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_parity(case):
    assert evaluate(case["task"], case["spec"], case["ctx"]) is case["expected"]
