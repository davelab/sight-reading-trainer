# Test fixtures

| File | Content | Source and licence |
|---|---|---|
| `minuet-in-g.musicxml` | Minuet in G, BWV Anh. 114 (Petzold), simplified two-staff arrangement written for these tests | Public domain |
| `bach-bwv269.rntxt` | Human Roman-numeral analysis of BWV 269 (analyst Andrew Jones; proofread by Dmitri Tymoczko and Hamish Robb) | [When in Rome](https://github.com/MarkGotham/When-in-Rome), `Corpus/Early_Choral/Bach,_Johann_Sebastian/Chorales/001`, CC BY-SA 4.0 |
| `bach-bwv17.7.rntxt` | Human Roman-numeral analysis of BWV 17.7 | When in Rome, `.../Chorales/007`, CC BY-SA 4.0 |

The scores of the Bach chorales (BWV 269 *Aus meines Herzens Grunde*,
Riemenschneider 1, and BWV 17.7 *Nun lob, mein Seel, den Herren*,
Riemenschneider 7) are NOT stored here: the tests take them from the music21
corpus (`bach/bwv269`, `bach/bwv17.7`), whose encodings (© Margaret
Greentree) are included in music21 by permission. See `conftest.py`.

To open one in the app:

```sh
uv run python -c "from music21 import corpus; corpus.parse('bach/bwv269').write('musicxml', fp='bwv269.musicxml')"
```

The `.rntxt` files are redistributed unchanged under CC BY-SA 4.0 and are
used only by the tests as the reference analysis (M3 exit criterion).
