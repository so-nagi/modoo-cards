# Banana Split Lubed

The user supplied `banana-l-1.wav` through `banana-l-7.wav` on 2026-10-04.
The source package identifies itself as **Banana Split Lubed by Akira**. Its
included `LICENSE.txt` and `config.json` are retained here.

- `originals/`: byte-for-byte supplied WAV files, PCM32, mono, 44,100 Hz.
- `clips/`: the full recordings converted to browser-compatible PCM16 at the
  original sample rate, with peak amplitude normalized to 0.90. No trimming,
  pitch changes, added silence, or synthesized sound.
- `manifest.json`: original/derived SHA-256 values, frame counts, gains and levels.
- `preview.wav`: a 4-second native-player listening check containing the same
  seven normalized clips in order, with 500 ms initial silence, 350 ms gaps and
  a 400 ms final tail. The click files themselves are unchanged.
- Generator: `scripts/generate_banana_sounds.py` using Python's standard library.
- Validation: `node --experimental-strip-types tests/features/sound-integrity.mjs`.

Action mapping: tap 1, navigation/save 2, reveal 3, again/delete 4, hard 5,
good 6, easy 7. On/off and the saved master volume continue to apply.

The player reuses loaded HTML audio elements after completed clicks and rewinds
them only on the next gesture, without immediately seeking at the natural end.
The settings panel exposes browser-native controls for the listening preview.
Browser playback events and non-silent PCM do not establish physical output in
Whale or the user's speakers; those need an actual listening check.
