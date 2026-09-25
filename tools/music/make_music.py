"""Build the game's music from the Farline OST masters (DESIGN §8.3).

    pnpm music -- ~/Downloads/FarlineOSTDemo

The masters are 160 kbps MP3s that live outside the repository. For every track the
game uses (`TRACKS`), this decodes the master with `mpg123`, trims silence off the
head (a loop would otherwise play a gap every time round), re-encodes it with `lame`
into `packages/client/public/music/<id>.mp3`, and prints its loudness together with the
gain that brings it to `TARGET_DB`. Those gains are what `clientConstants.music.tracks`
holds; they are printed rather than written because the table is also tuned by ear.

MP3 rather than AAC or Opus: it is the one format every browser plays, Playwright's
Chromium included, which the smoke test (DESIGN §10) runs in.

Needs `mpg123` and `lame` on the PATH (`brew install mpg123 lame`). Standard library
only otherwise.
"""

from __future__ import annotations

import array
import math
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "packages" / "client" / "public" / "music"

# Track id -> master file. Only what `clientConstants.music` points at ships.
TRACKS = {
    "farline1": "Farline1.mp3",
    "farline3": "Farline3.mp3",
    "farline4": "Farline4.mp3",
    "farline5": "Farline5.mp3",
    "farline6": "Farline6.mp3",
    "farline7": "Farline7.mp3",
    "farline8": "Farline8.mp3",
    "farline9": "Farline9.mp3",
    "farline11": "Farline11.mp3",
    "farline12": "Farline12.mp3",
    "farline13": "Farline13.mp3",
}

# Loudness every track is evened out to, as RMS in dBFS.
TARGET_DB = -18.0
# A sample under this is silence, for the head trim.
SILENCE_DB = -50.0
# Kept ahead of the first sound, so the trim never clips an attack.
HEAD_PAD_S = 0.01
# Average bitrate in kbps. The masters are 160 kbps; VBR at a comparable quality came
# out no smaller on this dense material, so the rate is pinned instead. The music sits
# under the game's own sounds, where the difference from the master does not carry.
LAME_ABR_KBPS = "112"


def need(tool: str) -> None:
    if shutil.which(tool) is None:
        sys.exit(f"{tool} is not on the PATH (brew install {tool})")


def read_wav(path: Path) -> tuple[wave._wave_params, array.array]:
    with wave.open(str(path), "rb") as w:
        params = w.getparams()
        if params.sampwidth != 2:
            sys.exit(f"{path.name}: expected 16-bit PCM from mpg123")
        samples = array.array("h")
        samples.frombytes(w.readframes(params.nframes))
    return params, samples


def head_trim_frames(samples: array.array, channels: int, rate: int) -> int:
    threshold = 32768 * 10 ** (SILENCE_DB / 20)
    for i, s in enumerate(samples):
        if abs(s) > threshold:
            return max(0, i // channels - int(HEAD_PAD_S * rate))
    return 0


def rms_db(samples: array.array) -> float:
    if not samples:
        return -120.0
    total = math.fsum(float(s) * s for s in samples)
    return 20 * math.log10(max(1e-9, math.sqrt(total / len(samples)) / 32768))


def build(track: str, master: Path, work: Path) -> tuple[float, float, float]:
    decoded = work / f"{track}.wav"
    subprocess.run(["mpg123", "-q", "-w", str(decoded), str(master)], check=True)
    params, samples = read_wav(decoded)
    ch, rate = params.nchannels, params.framerate
    skip = head_trim_frames(samples, ch, rate)
    trimmed = samples[skip * ch :]
    clean = work / f"{track}.trimmed.wav"
    with wave.open(str(clean), "wb") as w:
        w.setparams(params)
        w.writeframes(trimmed.tobytes())
    out = OUT / f"{track}.mp3"
    subprocess.run(
        ["lame", "--silent", "--abr", LAME_ABR_KBPS, "--noreplaygain", str(clean), str(out)],
        check=True,
    )
    return skip / rate, len(trimmed) / ch / rate, rms_db(trimmed)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: make_music.py <directory with the Farline masters>")
    src = Path(sys.argv[1]).expanduser()
    need("mpg123")
    need("lame")
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"{'track':<10} {'trim s':>6} {'length':>7} {'rms dB':>7} {'gain':>5} {'kB':>6}")
    with tempfile.TemporaryDirectory() as tmp:
        for track, name in TRACKS.items():
            master = src / name
            if not master.is_file():
                sys.exit(f"missing master: {master}")
            trimmed, length, loudness = build(track, master, Path(tmp))
            gain = 10 ** ((TARGET_DB - loudness) / 20)
            size = (OUT / f"{track}.mp3").stat().st_size / 1024
            print(
                f"{track:<10} {trimmed:6.2f} {length:6.1f}s {loudness:7.1f} "
                f"{gain:5.2f} {size:6.0f}"
            )


if __name__ == "__main__":
    main()
