import json
from pathlib import Path

import pytest

from app.svgsafe import MAX_ELEMENTS, SvgRejected, sanitize_svg

FIXTURES = json.loads((Path(__file__).resolve().parents[2] / "shared" / "svg-fixtures.json").read_text())
S = 'xmlns="http://www.w3.org/2000/svg"'


@pytest.mark.parametrize("fx", FIXTURES, ids=[f["name"] for f in FIXTURES])
def test_shared_fixtures(fx):
    if not fx["ok"]:
        with pytest.raises(SvgRejected):
            sanitize_svg(fx["svg"])
        return
    out = sanitize_svg(fx["svg"]).svg
    for needle in fx["mustContain"]:
        assert needle in out, f"{needle!r} missing from {out}"
    for needle in fx["mustNotContain"]:
        assert needle not in out, f"{needle!r} survived in {out}"


def test_output_is_canonical_and_stable_when_sanitized_twice():
    first = sanitize_svg(f'<svg {S} viewBox="0 0 100 200"><g id="a"><rect x="1" y="2" width="3" height="4" fill="#fff"/></g></svg>')
    assert first.svg.startswith(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200">')
    assert sanitize_svg(first.svg).svg == first.svg


def test_reports_what_was_removed():
    out = sanitize_svg(f'<svg {S} viewBox="0 0 100 200"><script>x</script><rect onclick="y" x="0" y="0" width="1" height="1"/></svg>')
    assert "<script>" in out.removed and "@onclick" in out.removed


def test_missing_viewbox_gets_the_default_for_the_kind():
    assert 'viewBox="0 0 100 200"' in sanitize_svg(f"<svg {S}><rect x='0' y='0' width='1' height='1'/></svg>", "figure").svg
    assert 'viewBox="0 0 1600 900"' in sanitize_svg(f"<svg {S}><rect x='0' y='0' width='1' height='1'/></svg>", "background").svg


def test_wrong_aspect_ratio_is_rejected_with_a_fixable_message():
    with pytest.raises(SvgRejected, match="aspect ratio"):
        sanitize_svg(f'<svg {S} viewBox="0 0 400 400"><rect x="0" y="0" width="1" height="1"/></svg>', "figure")
    assert "viewBox" in sanitize_svg(f'<svg {S} viewBox="0 0 200 400"><rect x="0" y="0" width="1" height="1"/></svg>', "figure").svg  # same ratio is fine
    with pytest.raises(SvgRejected, match="aspect ratio"):
        sanitize_svg(f'<svg {S} viewBox="0 0 100 200"><rect x="0" y="0" width="1" height="1"/></svg>', "background")


def test_size_limits():
    many = "".join('<rect x="0" y="0" width="1" height="1"/>' for _ in range(MAX_ELEMENTS + 5))
    with pytest.raises(SvgRejected, match="elements"):
        sanitize_svg(f'<svg {S} viewBox="0 0 100 200">{many}</svg>')
    deep = "<g>" * 20 + "</g>" * 20
    with pytest.raises(SvgRejected, match="nested"):
        sanitize_svg(f'<svg {S} viewBox="0 0 100 200">{deep}</svg>')
    with pytest.raises(SvgRejected, match="larger"):
        sanitize_svg(f'<svg {S} viewBox="0 0 100 200"><!-- {"x" * 70000} --></svg>')


def test_bad_ids_pivots_and_hrefs_are_dropped_not_kept():
    out = sanitize_svg(f'<svg {S} viewBox="0 0 100 200"><g id="has space" data-pivot="a,b"><use href="#9bad"/><rect id="ok_id" x="0" y="0" width="1" height="1"/></g></svg>').svg
    assert "has space" not in out and "data-pivot" not in out and "<use" not in out and 'id="ok_id"' in out


def test_childless_elements_are_self_closing():
    out = sanitize_svg(f'<svg {S} viewBox="0 0 100 200"><g id="a"><rect x="0" y="0" width="1" height="1"></rect></g></svg>').svg
    assert '<rect x="0" y="0" width="1" height="1"/>' in out and "</rect>" not in out and "</g>" in out


def test_output_never_exceeds_the_limit_even_when_cleaning_grows_it():
    from app.svgsafe import MAX_CHARS

    path = '<path d="M0 0' + " L1 1" * 1700 + '"/>'
    body = path * ((MAX_CHARS - 20) // len(path))
    body += '<path d="M0 0' + " " * (MAX_CHARS - len(body) - 27) + '"/>'
    grows = f"<svg>{body}</svg>"  # the cleaned copy gains an xmlns and a default viewBox
    assert MAX_CHARS - 20 < len(grows) <= MAX_CHARS
    with pytest.raises(SvgRejected, match="once cleaned"):
        sanitize_svg(grows)
