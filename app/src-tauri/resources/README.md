# SoundFont

Put a piano SoundFont (`.sf2`) in this folder; the first one in alphabetical
order is loaded at startup. `scripts/fetch-soundfont.sh` downloads a free one.
`SCORE_STUDIO_SOUNDFONT=/path/to/file.sf2` overrides the folder.

Without a SoundFont the app uses a small built-in fallback synth, so playback
still works (with a plainer sound). `.sf2` files are git-ignored: the choice
of the bundled SoundFont and its licence is an open decision (docs/SPEC.md).
