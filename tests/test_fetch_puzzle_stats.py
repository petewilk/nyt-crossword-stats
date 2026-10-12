from datetime import datetime

import pytest

import fetch_puzzle_stats as fps


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


@pytest.fixture
def fake_get(monkeypatch):
    """Route requests.get to canned payloads keyed by URL, recording each call"""
    calls = []
    payloads = {}

    def get(url, params=None, cookies=None):
        calls.append((url, params))
        return FakeResponse(payloads[url])

    monkeypatch.setattr(fps.requests, "get", get)
    return payloads, calls


def day(text):
    return datetime.strptime(text, fps.DATE_FORMAT)


def test_overview_null_results_is_empty(fake_get):
    payloads, _ = fake_get
    payloads[fps.PUZZLE_INFO] = {"results": None}
    assert fps.get_v3_puzzle_overview("mini", day("2010-01-01"), day("2010-02-01"), "c") == []


@pytest.mark.parametrize("puzzle_type, game", [("daily", "crossword_daily"), ("mini", "crossword_mini")])
def test_states_use_the_game_for_the_type(fake_get, puzzle_type, game):
    payloads, calls = fake_get
    url = fps.PUZZLE_STATES.format(game=game)
    payloads[url] = {"states": [{"puzzle_id": 1}]}
    assert fps.get_puzzle_states([1, 2], puzzle_type, "c") == [{"puzzle_id": 1}]
    assert calls == [(url, {"puzzle_ids": "1,2"})]


def test_states_null_is_empty(fake_get):
    payloads, _ = fake_get
    payloads[fps.PUZZLE_STATES.format(game="crossword_mini")] = {"states": None}
    assert fps.get_puzzle_states([1], "mini", "c") == []


def test_bonus_is_rejected():
    with pytest.raises(SystemExit):
        fps.parser.parse_args(["--type", "bonus"])


def test_all_calls_use_https():
    assert fps.PUZZLE_INFO.startswith("https://")
    assert fps.PUZZLE_STATES.startswith("https://")


def test_date_batches_cover_the_range_without_gaps():
    batches = fps.date_batches(day("2020-01-01"), day("2020-12-31"))
    assert batches[0][0] == day("2020-01-01")
    assert batches[-1][1] == day("2020-12-31")
    for (_, end), (start, _) in zip(batches, batches[1:]):
        assert (start - end).days == 1
    assert all((end - start).days < fps.BATCH_SIZE for start, end in batches)


def test_date_batches_empty_when_start_after_end():
    assert fps.date_batches(day("2020-02-01"), day("2020-01-01")) == []


def test_shape_overview_adds_weekday_and_renames_star():
    row = fps.shape_overview({"print_date": "2023-12-24", "star": "Gold"})
    assert row["day_of_week_name"] == "Sunday"
    assert row["day_of_week_integer"] == "0"
    assert row["gold_star"] == "Gold" and "star" not in row


def test_shape_state_counts_lists_and_drops_cells():
    state = fps.shape_state({"cells": [1], "star": "Gold", "checked": [1, 2], "revealed": []})
    assert state == {"state_star": "Gold", "checked": 2, "revealed": 0}


def test_fetch_stats_merges_states_and_writes_csv(fake_get, tmp_path):
    payloads, _ = fake_get
    payloads[fps.PUZZLE_INFO] = {"results": [{"puzzle_id": 7, "print_date": "2024-01-01"}]}
    payloads[fps.PUZZLE_STATES.format(game="crossword_mini")] = {
        "states": [{"puzzle_id": 7, "game_data": {"solved": True, "firstSolve": 42, "newField": 1}}]
    }
    puzzles = fps.fetch_stats("mini", day("2024-01-01"), day("2024-01-01"), "c")
    assert puzzles["7"]["firstSolve"] == 42

    out = tmp_path / "out.csv"
    fps.write_csv(puzzles, out)
    header, row = out.read_text().splitlines()
    assert header.split(",") == fps.CSV_FIELDS
    assert "newField" not in header


def test_resolve_cookie_prefers_env(monkeypatch):
    monkeypatch.setattr(fps, "load_dotenv", lambda path: None)
    monkeypatch.setenv("NYT_COOKIE", "from-env")
    assert fps.resolve_cookie("u", "p") == "from-env"


def test_resolve_cookie_needs_credentials_without_env(monkeypatch):
    monkeypatch.setattr(fps, "load_dotenv", lambda path: None)
    monkeypatch.delenv("NYT_COOKIE", raising=False)
    with pytest.raises(SystemExit):
        fps.resolve_cookie()
