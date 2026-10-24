from fastapi.testclient import TestClient

from app.main import app
from app.tinyfish import harness

SCHEMA = {"type": "object", "properties": {"found": {"type": "boolean"}, "message": {"type": "string"}},
          "required": ["found", "message"]}


def task(kind="wapsi"):
    return harness.Task(source={"id": "x", "name": "X", "kind": kind}, goal="g", url="https://licindia.in",
                        output_schema=SCHEMA)


def test_completed_is_not_success():
    assert harness.verify(task(), "FAILED", None, {"message": "timeout"})[0] == "failed"
    assert harness.verify(task(), "COMPLETED", {}, None)[0] == "failed"
    assert harness.verify(task(), "COMPLETED", {"found": "", "message": ""}, None)[0] == "failed"


def test_captcha_reported_as_not_found_is_blocked():
    # seen live: an agent hit a CAPTCHA, then reported found=false
    res = {"found": False, "message": "CAPTCHA verification failed repeatedly, preventing the search"}
    assert harness.verify(task(), "COMPLETED", res, None)[0] == "blocked"


def test_echoed_holder_name_is_dropped():
    assert "holder_name" not in harness._sanitize({"found": False, "message": "none", "holder_name": "Ramesh"})


def test_non_official_links_are_suspicious():
    res = {"found": True, "message": "see https://lic-claims-help.xyz/form"}
    assert harness.verify(task(), "COMPLETED", res, None)[0] == "suspicious"
    assert harness.verify(task(), "COMPLETED", {"found": False, "message": "No record"}, None)[0] == "verified"


def test_planner_routes_otp_portals_to_humans():
    tasks = harness.plan("wapsi", {"all", "family"}, {"name": "Test Name", "dob": "01/01/1970"})
    by_id = {t.source["id"]: t for t in tasks}
    assert by_id["udgam"].source.get("requires_human") and by_id["sbi_life_unclaimed"].source.get("requires_human")
    assert "Test Name" in by_id["tata_aia_unclaimed"].goal and "not provided" not in by_id["tata_aia_unclaimed"].goal.split("'")[1]


def test_api_end_to_end(personas):
    with TestClient(app) as c:
        assert c.get("/api/health").json()["ok"]
        ev = c.post("/api/evaluate", json={"profile": personas["sunita"]}).json()
        assert ev["haq_meter"]["total_inr"] == 62000
        s = c.post("/api/scam/check", json={"text": "pay ₹499 fee at viksitbharatrozgaryojana.org", "deep": False}).json()
        assert s["verdict"] == "likely_fake" and s["safe_steps"]
        a = c.post("/api/ask", json={"q": "widow pension delhi kitna milta hai"}).json()
        assert a["sources"] and a["sources"][0]["id"] == "scheme:delhi_widow_pension"
        assert c.post("/api/wapsi/start", json={"profile": personas["sunita"], "person": {"name": "X"}}).status_code == 400
        pack = c.post("/api/application-pack/csss", json={"profile": personas["sunita"], "who": "daughter"}).json()
        assert pack["status"] == "eligible"


def test_parallel_requests_do_not_crash_z3(personas):
    """Regression: the home screen fires two solver requests at once; Z3 is not thread-safe."""
    import concurrent.futures as cf

    with TestClient(app) as c:
        def hit(i):
            p = {**personas["sunita"], "age": 40 + i}
            return (c.post("/api/evaluate", json={"profile": p}).status_code,
                    c.post("/api/radar/alerts", json={"profile": p}).status_code)

        with cf.ThreadPoolExecutor(8) as ex:
            assert set(ex.map(hit, range(16))) == {(200, 200)}


def test_portal_error_is_reported_not_trusted():
    res = {"found": False, "message": "We're Sorry! Something went wrong, Please Try Again"}
    assert harness.verify(task(), "COMPLETED", res, None)[0] == "failed"


def test_research_stream_always_ends():
    """Regression: without an explicit end event the browser's EventSource reconnects and re-runs research."""
    with TestClient(app) as c:
        with c.stream("GET", "/api/ask/research", params={"q": "Delhi widow pension amount and eligibility"}) as s:
            lines = [ln for ln in s.iter_lines()]
    assert any(ln.startswith("event: end") for ln in lines)
