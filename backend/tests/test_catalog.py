"""Explore: sentence → filters, official NSP deadlines, safe name matching, search with facets."""

from datetime import date

from app.services import catalog as c


def test_command_parser_understands_hindi_english_and_hinglish():
    p = c.parse_command("get me all scholarship schemes which are live")
    assert p["filters"] == {"cat": ["education"], "status": ["live"]} and p["q"] == ""
    p = c.parse_command("scholarships for SC girls in Delhi closing this month")
    assert set(p["filters"]["group"]) == {"sc", "girls"} and p["filters"]["status"] == [
        "closing_soon"
    ]
    assert p["filters"]["where"] == [
        "Delhi",
        "central",
    ]  # a Delhi resident also gets every central scheme
    p = c.parse_command("मुझे दिल्ली में छात्रवृत्ति दिखाओ")
    assert (
        p["filters"]["cat"] == ["education"] and "Delhi" in p["filters"]["where"] and p["q"] == ""
    )
    assert c.parse_command("kisan ke liye yojana")["filters"]["group"] == ["farmers"]
    assert c.parse_command("which schemes am I eligible for")["intent"] == "eligible"
    # Hindi plurals and gender forms reduce to one stem
    p = c.parse_command("अभी खुली छात्रवृत्तियाँ")
    assert p["filters"] == {"status": ["live"], "cat": ["education"]} and p["q"] == ""
    assert c.parse_command("किसानों के लिए योजनाएँ")["filters"]["group"] == ["farmers"]
    p = c.parse_command("इस महीने बंद होने वाली")
    assert p["filters"] == {"status": ["closing_soon"]} and p["q"] == ""
    assert c.parse_command("Help for farmers")["q"] == ""  # filler words never narrow the search


NSP_TEXT = """###### Pre Matric Scholarship For Students With Disabilities (Welfare Based Scheme)

Scheme Open from : 25-07-2026
Student Application Open till : 31-10-2026

###### PM-USP – Central Sector Scheme Of Scholarship For College And University Students (CSSS) (Merit Based Scheme)

Scheme Open from (for Renewal): 01-06-2026
Student Application Open till (for Renewal): 31-10-2026
"""


def test_nsp_list_parsing_and_status():
    rows = c.parse_nsp(NSP_TEXT)
    assert [r["apply_till"] for r in rows] == ["2026-10-31", "2026-10-31"]
    assert rows[1]["renewal"] and not rows[0]["renewal"]
    assert c._nsp_status(rows[0], today=date(2026, 10, 24)) == "closing_soon"
    assert c._nsp_status(rows[0], today=date(2026, 9, 1)) == "open"
    assert c._nsp_status(rows[0], today=date(2026, 7, 1)) == "upcoming"
    assert c._nsp_status(rows[0], today=date(2026, 11, 2)) == "date_passed"


def test_deadline_matching_never_crosses_pre_and_post_matric():
    rows = c.parse_nsp(NSP_TEXT)
    assert c._nsp_match("Pre Matric Scholarship For Students With Disabilities", rows)[
        "name"
    ].startswith("Pre Matric")
    assert c._nsp_match("Post Matric Scholarship Students With Disabilities", rows) is None
    assert c._nsp_match("Post-Matric Scholarship for SC Students", rows) is None
    assert (
        "CSSS"
        in c._nsp_match(
            "Central Sector Scholarship for College & University Students (PM-USP CSSS)", rows
        )["name"]
    )


def test_deadline_sentences_from_page_text():
    st, dl, _ = c.deadline_status(
        "Last date to apply is 15 November 2026.", today=date(2026, 10, 24)
    )
    assert (st, dl) == ("open", "2026-11-15")
    assert c.deadline_status("The scheme provides ₹6,000 per year.")[0] == "unknown"
    assert (
        c.deadline_status("Applications close on 31-03-2024", today=date(2026, 10, 24))[0]
        == "date_passed"
    )


def test_search_filters_and_facets():
    r = c.search("", {"cat": ["pension"], "group": ["widows"], "where": ["Delhi", "central"]})
    ids = [i["id"] for i in r["items"]]
    assert "delhi_widow_pension" in ids and "ignwps" in ids
    assert all("pension" in i["cats"] for i in r["items"])
    assert {f["value"] for f in r["facets"]["where"]} >= {"central"}
    r2 = c.search("", {"cat": ["pension"]}, eligible=["ignwps"])
    assert r2["items"][0]["id"] == "ignwps" and r2["items"][0]["you_qualify"]
