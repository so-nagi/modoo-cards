"""Derive browser-compatible PCM16 effects from the user's untouched PCM32 WAVs."""
from array import array
import hashlib
import json
import math
from pathlib import Path
import sys
import wave

ROOT = Path(__file__).resolve().parents[1] / 'public/sounds/banana-split-lubed'


def main():
    target = ROOT / 'clips'
    target.mkdir(exist_ok=True)
    manifest = {'format': 'PCM signed 16-bit little-endian', 'clips': {}}
    preview_samples = bytearray()
    preview_segments = []
    preview_format = None
    for index in range(1, 8):
        name = f'banana-l-{index}.wav'
        source = ROOT / 'originals' / name
        with wave.open(str(source), 'rb') as recording:
            if recording.getsampwidth() != 4 or recording.getcomptype() != 'NONE':
                raise ValueError(f'{name}: expected supplied PCM32 recording')
            frames, rate, channels = recording.getnframes(), recording.getframerate(), recording.getnchannels()
            samples = array('i', recording.readframes(frames))
        if sys.byteorder != 'little':
            samples.byteswap()
        peak = max(abs(value / 2**31) for value in samples)
        if peak < 0.001:
            raise ValueError(f'{name}: silent recording')
        gain = min(8, 0.9 / peak)
        output = array('h', (round(value / 2**31 * gain * 32767) for value in samples))
        rms = math.sqrt(sum((value / 32768) ** 2 for value in output) / len(output))
        if sys.byteorder != 'little':
            output.byteswap()
        destination = target / name
        with wave.open(str(destination), 'wb') as recording:
            recording.setnchannels(channels)
            recording.setsampwidth(2)
            recording.setframerate(rate)
            recording.writeframes(output.tobytes())
        if preview_format is None:
            preview_format = (rate, channels)
            preview_samples.extend(bytes(round(rate * 0.5) * channels * 2))
        if preview_format != (rate, channels):
            raise ValueError('Preview recordings must use the same sample rate and channel count')
        preview_segments.append({'file': name, 'startFrame': len(preview_samples) // (channels * 2), 'frames': frames})
        preview_samples.extend(output.tobytes())
        preview_samples.extend(bytes(round(rate * (0.4 if index == 7 else 0.35)) * channels * 2))
        manifest['clips'][name] = {
            'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
            'sampleRate': rate, 'channels': channels, 'frames': frames,
            'gain': round(gain, 6), 'peak': round(peak * gain, 6), 'rms': round(rms, 6),
        }
    preview_path = ROOT / 'preview.wav'
    with wave.open(str(preview_path), 'wb') as recording:
        recording.setnchannels(channels)
        recording.setsampwidth(2)
        recording.setframerate(rate)
        recording.writeframes(preview_samples)
    manifest['preview'] = {'file': preview_path.name, 'sha256': hashlib.sha256(preview_path.read_bytes()).hexdigest(),
                           'sampleRate': rate, 'channels': channels, 'frames': len(preview_samples) // (channels * 2),
                           'segments': preview_segments}
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'clips': len(manifest['clips']), 'format': manifest['format']}))


if __name__ == '__main__':
    main()
