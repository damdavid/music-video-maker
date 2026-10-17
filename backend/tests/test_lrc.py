from app.lrc import parse, serialize
from app.models import Line, Lyrics, Word


def test_line_level_round_trip():
    src = "[00:12.34]Hello there\n[01:05.00]General Kenobi\n"
    lyrics = parse(src)
    assert [l.start for l in lyrics.lines] == [12.34, 65.0]
    assert lyrics.lines[0].end == 65.0
    assert serialize(lyrics) == src


def test_enhanced_round_trip():
    lyrics = Lyrics(
        lines=[
            Line(
                start=1.0,
                end=2.5,
                text="hello world",
                words=[Word(start=1.0, end=1.5, text="hello"), Word(start=1.5, end=2.5, text="world")],
            )
        ]
    )
    text = serialize(lyrics, enhanced=True)
    assert text == "[00:01.00]<00:01.00>hello <00:01.50>world <00:02.50>\n"
    assert parse(text) == lyrics


def test_ignores_metadata_and_handles_multiple_tags():
    lyrics = parse("[ti:Song]\n[ar:Band]\n[00:30.00][00:10.00]Chorus\n")
    assert [l.start for l in lyrics.lines] == [10.0, 30.0]
    assert all(l.text == "Chorus" for l in lyrics.lines)
