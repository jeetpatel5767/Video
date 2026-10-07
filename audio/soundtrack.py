"""Soundtrack for the Jeet portfolio video, synthesised from scratch (no samples).

Qawwali / Hindustani-classical flavour in D Kafi (Dorian): tanpura drone, harmonium,
bansuri, dholak + tabla, crowd taali (hand-claps), a modern sub kick and bass,
and sound effects synced to the picture via video/cues.json. Ends with a tihai
landing on sam.

Usage: python audio/soundtrack.py <out_dir>
Writes <out_dir>/soundtrack.wav (48 kHz float, pre-loudnorm) and <out_dir>/levels.json
(per-video-frame band levels + hit times that drive the audio-reactive visuals).
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.ndimage import minimum_filter1d
from scipy.signal import butter, fftconvolve, lfilter, resample_poly, sosfilt

ROOT = Path(__file__).resolve().parent.parent
CUES = json.loads((ROOT / "video" / "cues.json").read_text())
SR = 48000
DUR = CUES["duration"]
N = int(SR * DUR)
BEAT = 60 / CUES["bpm"]
E8 = BEAT / 2          # eighth note
S16 = BEAT / 4         # sixteenth note
rng = np.random.default_rng(5767)


# ---------------------------------------------------------------- helpers
def ts(d):
    return np.arange(int(round(d * SR))) / SR


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


_sos = {}


def filt(x, kind, f, order=2):
    key = (kind, f if np.isscalar(f) else tuple(f), order)
    if key not in _sos:
        _sos[key] = butter(order, f, btype=kind, fs=SR, output="sos")
    return sosfilt(_sos[key], x)


def env_adsr(n, a=0.005, r=0.05, sustain_until=None):
    e = np.ones(n)
    na = max(1, int(a * SR))
    e[:na] = np.linspace(0, 1, na) ** 0.7
    nr = max(1, int(r * SR))
    if nr < n:
        e[-nr:] *= np.linspace(1, 0, nr) ** 1.5
    return e


def norm(x, peak=1.0):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


class Bus:
    def __init__(self):
        self.x = np.zeros((2, N))

    def add(self, sig, t, gain=1.0, pan=0.0):
        sig = np.asarray(sig, dtype=float)
        if sig.ndim == 1:
            th = (np.clip(pan, -1, 1) + 1) * np.pi / 4
            sig = np.vstack([sig * np.cos(th), sig * np.sin(th)]) * np.sqrt(2)
        i0 = int(round(t * SR))
        s0 = max(0, -i0)
        i0 = max(0, i0)
        n = min(sig.shape[1] - s0, N - i0)
        if n > 0:
            self.x[:, i0:i0 + n] += gain * sig[:, s0:s0 + n]


def hum(t):
    """Tiny deterministic humanisation of hit times."""
    return t + rng.normal(0, 0.0035)


# ---------------------------------------------------------------- instruments
def karplus(freq, dur, decay=0.996, bright=0.6, detune=0.0):
    """Plucked string: Karplus-Strong with an allpass fractional delay so it stays in tune."""
    n = int(dur * SR)
    f = freq * (1 + detune)
    P = SR / f
    Nd = int(np.floor(P - 0.6))
    d = P - 0.5 - Nd
    c = (1 - d) / (1 + d)
    g = decay
    a = np.zeros(Nd + 3)
    a[0] = 1
    a[1] += c
    a[Nd] += -g / 2 * c
    a[Nd + 1] += -g / 2 * (1 + c)
    a[Nd + 2] += -g / 2
    exc = rng.uniform(-1, 1, int(P) + 1)
    exc = lfilter([bright, 1 - bright], [1], exc)  # darker pluck = lower bright
    x = np.zeros(n)
    x[:len(exc)] = exc
    y = lfilter([1, c], a, x)
    y *= env_adsr(n, a=0.001, r=0.08)
    return y


def santoor(freq, dur=1.6, vel=1.0):
    y = karplus(freq, dur, decay=0.9975, bright=0.85) + karplus(freq, dur, 0.9975, 0.85, detune=0.0016)
    y = filt(y, "highpass", 180)
    return norm(y) * vel


_tanpura_cache = {}


def tanpura(freq, variant):
    key = (round(freq, 3), variant)
    if key not in _tanpura_cache:
        _tanpura_cache[key] = tanpura_pluck(freq)
    return _tanpura_cache[key]


def tanpura_pluck(freq, dur=4.5):
    """Additive tanpura: rich harmonics with the jawari 'bloom' sweeping down the spectrum."""
    t = ts(dur)
    y = np.zeros_like(t)
    F = 5200 * np.exp(-t / 0.7) + 700          # moving buzz formant
    K = int(min(70, 11000 / freq))
    for k in range(1, K + 1):
        fk = freq * k
        tau = 3.2 / (1 + 0.035 * k)
        bloom = 1 + 2.2 * np.exp(-((fk - F) / 1300) ** 2)
        amp = k ** -0.75 * np.exp(-t / tau) * bloom
        y += amp * np.sin(2 * np.pi * fk * t * (1 + 0.00012 * np.sin(2 * np.pi * 0.7 * t)) + rng.uniform(0, 2 * np.pi))
    y *= env_adsr(len(t), a=0.004, r=0.4)
    return norm(y)


def harmonium_note(freq, dur, vel=1.0, low_reed=False):
    t = ts(dur)
    y = np.zeros_like(t)
    reeds = [(1.0, 1.0), (2 ** (2.6 / 1200), 0.8)]
    if low_reed:
        reeds.append((0.5, 0.55))
    for ratio, g in reeds:
        f = freq * ratio
        K = int(min(45, 14000 / f))
        for k in range(1, K + 1):
            fk = f * k
            spec = (1 / k) * (1 + 1.4 * np.exp(-((fk - 1150) / 520) ** 2) + 0.6 * np.exp(-((fk - 2600) / 700) ** 2)) / (1 + (fk / 6500) ** 2)
            y += g * spec * np.sin(2 * np.pi * fk * t + 0.3 * k)
    bellows = 1 + 0.012 * np.sin(2 * np.pi * 3.1 * t) + 0.006 * np.sin(2 * np.pi * 5.3 * t + 1)
    e = env_adsr(len(t), a=0.045, r=0.11) * bellows
    return y * e * vel


def harmonium_chord(midis, dur, vel=1.0):
    y = sum(harmonium_note(midi(m), dur, 1.0, low_reed=(i == 0)) for i, m in enumerate(midis))
    return norm(filt(y, "lowpass", 9000)) * vel


def flute_phrase(notes, glide=0.075, vib_cents=16):
    """Bansuri line. notes = [(start, midi, dur), ...] relative to phrase start; meend glides between legato notes."""
    end = max(s + d for s, m, d in notes) + 0.25
    t = ts(end)
    n = len(t)
    f0 = np.zeros(n)
    amp = np.zeros(n)
    vib_w = np.zeros(n)
    chiff = np.zeros(n)
    prev_f = None
    prev_end = -1
    for s, m, d in notes:
        i0, i1 = int(s * SR), min(n, int((s + d) * SR))
        f = midi(m)
        seg = np.full(i1 - i0, f)
        legato = prev_f is not None and s - prev_end < 0.03
        if legato:
            g = min(len(seg), int(glide * SR))
            w = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, g))
            seg[:g] = prev_f * (f / prev_f) ** w
        f0[i0:i1] = seg
        L = i1 - i0
        a = np.ones(L)
        na = int((0.03 if legato else 0.06) * SR)
        a[:na] = np.linspace(0.75 if legato else 0, 1, na)
        nr = int(0.07 * SR)
        a[-nr:] *= np.linspace(1, 0.82, nr)
        amp[i0:i1] = np.maximum(amp[i0:i1], a)
        tt = np.arange(L) / SR
        vib_w[i0:i1] = np.clip((tt - 0.22) / 0.35, 0, 1)
        if not legato:
            k = min(L, int(0.035 * SR))
            chiff[i0:i0 + k] += np.exp(-np.arange(k) / (0.008 * SR))
        prev_f, prev_end = f, s + d
    # fill tiny gaps in f0 so the oscillator never runs at 0 Hz
    last = midi(notes[0][1])
    for i in range(n):
        if f0[i] == 0:
            f0[i] = last
        else:
            last = f0[i]
    nr = int(0.18 * SR)
    amp[-nr:] *= np.linspace(1, 0, nr)
    amp = lfilter([0.004], [1, -0.996], amp)  # smooth breath envelope
    vib = 2 ** (vib_cents * vib_w * np.sin(2 * np.pi * 5.2 * t) / 1200)
    ph = 2 * np.pi * np.cumsum(f0 * vib) / SR
    tone = np.sin(ph) + 0.2 * np.sin(2 * ph + 0.4) + 0.06 * np.sin(3 * ph + 1.1) + 0.025 * np.sin(4 * ph)
    breath = filt(rng.normal(0, 1, n), "bandpass", (1400, 7000)) * 0.05
    breath_pitched = filt(rng.normal(0, 1, n), "lowpass", 900) * (1 + np.sin(ph)) * 0.035
    ch = filt(rng.normal(0, 1, n), "bandpass", (1800, 6000)) * chiff * 0.35
    y = (tone + breath + breath_pitched) * amp + ch
    return y


def kick(vel=1.0):
    t = ts(0.6)
    f = 47 + 115 * np.exp(-t / 0.032)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t / 0.33) * env_adsr(len(t), 0.0008, 0.05)
    y = np.tanh(1.6 * y) / np.tanh(1.6)
    click = filt(rng.normal(0, 1, len(t)), "highpass", 2500) * np.exp(-t / 0.0018) * 0.25
    return (y + click) * vel


def dholak_bass(vel=1.0, bend=1.22, f0=82):
    """Left head 'ge/dhum': deep tone that glides up as the palm presses."""
    t = ts(0.7)
    f = f0 * (1 + (bend - 1) * (1 - np.exp(-t / 0.07)))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = (np.sin(ph) + 0.28 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)) * np.exp(-t / 0.26)
    thump = filt(rng.normal(0, 1, len(t)), "lowpass", 380) * np.exp(-t / 0.014) * 0.9
    return (y + thump) * env_adsr(len(t), 0.0015, 0.08) * vel


def dholak_treble(vel=1.0, f=540, open_=True):
    t = ts(0.35)
    ratios = [1, 1.59, 2.14, 2.3, 2.65, 2.92]
    amps = [1, 0.55, 0.42, 0.3, 0.22, 0.14]
    y = np.zeros_like(t)
    scale = 1.0 if open_ else 0.35
    for r, a in zip(ratios, amps):
        y += a * np.sin(2 * np.pi * f * r * t + r) * np.exp(-t / (0.085 * scale / (0.7 + 0.3 * r)))
    slap = filt(rng.normal(0, 1, len(t)), "bandpass", (1800, 9000)) * np.exp(-t / 0.007) * 2.1
    return (y * 0.8 + slap) * env_adsr(len(t), 0.0006, 0.04) * vel


def tabla_na(vel=1.0, f=midi(62), kind="na"):
    """Dayan strokes tuned to Sa: 'na' rings, 'tin' favours the 2nd harmonic, 'ta' is short."""
    t = ts(0.9)
    if kind == "na":
        parts = [(1, 1, 0.42), (2, 0.55, 0.3), (3, 0.38, 0.22), (4, 0.2, 0.15), (5, 0.12, 0.1)]
    elif kind == "tin":
        parts = [(1, 0.25, 0.12), (2, 1, 0.3), (3, 0.35, 0.18), (4, 0.25, 0.12)]
    else:  # ta
        parts = [(1, 0.8, 0.09), (2, 0.6, 0.07), (3, 0.4, 0.05), (4, 0.3, 0.04)]
    y = np.zeros_like(t)
    for k, a, tau in parts:
        y += a * np.sin(2 * np.pi * f * k * t * (1 + 0.004 * np.exp(-t / 0.02))) * np.exp(-t / tau)
    hit = filt(rng.normal(0, 1, len(t)), "bandpass", (2000, 8000)) * np.exp(-t / 0.004) * 0.6
    return (y + hit) * env_adsr(len(t), 0.0005, 0.1) * vel


def ka(vel=1.0):
    t = ts(0.12)
    y = filt(rng.normal(0, 1, len(t)), "bandpass", (250, 1400)) * np.exp(-t / 0.018)
    return y * vel * 1.4


def ghungroo(vel=1.0):
    """Ankle bells (Kathak ghungroo): a cluster of tiny inharmonic bells."""
    t = ts(0.22)
    y = np.zeros_like(t)
    for _ in range(7):
        f = rng.uniform(4200, 8200)
        d = int(rng.uniform(0, 0.012) * SR)
        tt = t[: len(t) - d]
        b = sum(a * np.sin(2 * np.pi * f * r * tt + rng.uniform(0, 6)) for r, a in [(1, 1), (1.47, 0.5), (2.09, 0.3)])
        y[d:] += b * np.exp(-tt / rng.uniform(0.03, 0.07))
    y += filt(rng.normal(0, 1, len(t)), "highpass", 6000) * np.exp(-t / 0.01) * 0.8
    return norm(y) * vel


def biquad(x, kind, f, gain_db=0.0, q=0.707):
    """RBJ cookbook shelves / peaking EQ."""
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f / SR
    cw, sw = np.cos(w), np.sin(w)
    al = sw / (2 * q)
    if kind == "peak":
        b = [1 + al * A, -2 * cw, 1 - al * A]
        a = [1 + al / A, -2 * cw, 1 - al / A]
    else:
        sq = 2 * np.sqrt(A) * al
        if kind == "lowshelf":
            b = [A * ((A + 1) - (A - 1) * cw + sq), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sq)]
            a = [(A + 1) + (A - 1) * cw + sq, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sq]
        else:
            b = [A * ((A + 1) + (A - 1) * cw + sq), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sq)]
            a = [(A + 1) - (A - 1) * cw + sq, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sq]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


CLAPPERS = [dict(pan=p, fc=fc, lag=lag) for p, fc, lag in zip(
    [-0.75, -0.45, -0.2, 0.05, 0.25, 0.5, 0.78, -0.6, 0.62],
    [1050, 1350, 1200, 1500, 950, 1250, 1400, 1150, 1300],
    [0.004, -0.006, 0.0, 0.009, -0.003, 0.006, -0.008, 0.012, -0.011])]


def one_clap(fc):
    t = ts(0.32)
    n = len(t)
    y = np.zeros(n)
    for k, off in enumerate([0.0, 0.0065, 0.0125, 0.019]):
        i = int(off * SR)
        tt = t[: n - i]
        y[i:] += rng.normal(0, 1, n - i) * np.exp(-tt / 0.0022) * (0.85 ** k)
    i = int(0.019 * SR)
    y[i:] += rng.normal(0, 1, n - i) * np.exp(-t[: n - i] / 0.055) * 0.5
    y = filt(y, "bandpass", (fc / 1.7, fc * 1.9))
    y = filt(y, "highpass", 450)
    return y


def taali(bus, t, vel=1.0, people=7):
    """Qawwali crowd clap: several people, each with their own pan, tone and timing."""
    for c in CLAPPERS[:people]:
        if rng.random() < 0.92:
            bus.add(norm(one_clap(c["fc"] * rng.uniform(0.95, 1.05))), t + c["lag"] + rng.normal(0, 0.003),
                    gain=vel * rng.uniform(0.6, 1.0) / np.sqrt(people), pan=c["pan"])


def bass_note(freq, dur, vel=1.0):
    t = ts(dur + 0.12)
    ph = 2 * np.pi * freq * t
    y = np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.07 * np.sin(3 * ph)
    y = np.tanh(1.7 * y)
    e = np.minimum(1, t / 0.006) * (0.7 + 0.3 * np.exp(-t / 0.12))
    e *= np.clip((dur + 0.12 - t) / 0.12, 0, 1)
    return filt(y * e, "lowpass", 700) * vel


# ---------------------------------------------------------------- sound effects
def pop(f_hi=950, f_lo=430, vel=1.0):
    t = ts(0.16)
    f = f_lo + (f_hi - f_lo) * np.exp(-t / 0.028)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t / 0.055) * env_adsr(len(t), 0.001, 0.03)
    click = filt(rng.normal(0, 1, len(t)), "highpass", 3000) * np.exp(-t / 0.0015) * 0.15
    return (y + click) * vel


def thock(vel=1.0):
    t = ts(0.35)
    f = 120 + 90 * np.exp(-t / 0.02)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.085)
    wood = sum(a * np.sin(2 * np.pi * fr * t) * np.exp(-t / dt) for fr, a, dt in [(520, 0.5, 0.03), (910, 0.3, 0.02), (1430, 0.18, 0.015)])
    slap = filt(rng.normal(0, 1, len(t)), "bandpass", (900, 5000)) * np.exp(-t / 0.006) * 0.8
    return (body + wood + slap) * env_adsr(len(t), 0.0005, 0.05) * vel


def tick(f=2350, vel=1.0):
    t = ts(0.09)
    y = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 1.48 * t)) * np.exp(-t / 0.018)
    click = filt(rng.normal(0, 1, len(t)), "highpass", 4000) * np.exp(-t / 0.001) * 0.4
    return (y + click) * env_adsr(len(t), 0.0003, 0.02) * vel


def mouse_click(vel=1.0):
    t = ts(0.05)
    y = filt(rng.normal(0, 1, len(t)), "bandpass", (2500, 9000)) * np.exp(-t / 0.0016)
    y += 0.4 * np.sin(2 * np.pi * 1700 * t) * np.exp(-t / 0.006)
    return y * vel


def bell(f=midi(86), dur=3.0, vel=1.0):
    """Risset-style bell for the 'perfect' moment."""
    t = ts(dur)
    parts = [(0.56, 1.0, 1.0), (0.92, 0.67, 0.9), (1.19, 1.0, 0.65), (1.71, 1.8, 0.55), (2.0, 2.67, 0.33),
             (2.74, 1.67, 0.33), (3.0, 1.46, 0.25), (3.76, 1.33, 0.2), (4.07, 1.33, 0.15)]
    y = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (dur * d * 0.35)) for r, a, d in parts)
    return norm(y * env_adsr(len(t), 0.001, 0.3)) * vel


def noise_sweep(dur, f_start, f_end, shape="rise", vel=1.0, pan_from=-0.6, pan_to=0.6):
    """Whooshes and risers: band-split noise whose centre frequency sweeps, with a moving pan."""
    t = ts(dur)
    n = len(t)
    u = t / dur
    fc = f_start * (f_end / f_start) ** u
    bands = [(150, 300), (300, 600), (600, 1200), (1200, 2400), (2400, 4800), (4800, 9600), (9600, 16000)]
    src = rng.normal(0, 1, n)
    y = np.zeros(n)
    for lo, hi in bands:
        c = np.sqrt(lo * hi)
        w = np.exp(-(np.log2(c / fc)) ** 2 / (2 * 0.8 ** 2))
        y += filt(src, "bandpass", (lo, hi)) * w
    if shape == "rise":
        a = u ** 2.2
    elif shape == "whoosh":
        a = np.sin(np.pi * np.clip(u, 0, 1)) ** 1.6 * np.exp(-((u - 0.62) / 0.5) ** 2)
    else:
        a = np.exp(-u * 4)
    y = norm(y * a)
    pan = pan_from + (pan_to - pan_from) * u
    th = (pan + 1) * np.pi / 4
    return np.vstack([y * np.cos(th), y * np.sin(th)]) * np.sqrt(2) * vel


def boom(vel=1.0):
    t = ts(2.6)
    f = 36 + 30 * np.exp(-t / 0.12)
    ph = 2 * np.pi * np.cumsum(f) / SR
    sub = np.sin(ph) * np.exp(-t / 0.9) * env_adsr(len(t), 0.002, 0.4)
    rumble = filt(rng.normal(0, 1, len(t)), "lowpass", 160) * np.exp(-t / 0.5) * 0.6
    crack = filt(rng.normal(0, 1, len(t)), "bandpass", (700, 5000)) * np.exp(-t / 0.035) * 0.5
    return (np.tanh(1.3 * sub) + rumble + crack) * vel


def scribble(dur=0.42, vel=1.0):
    t = ts(dur)
    strokes = np.abs(np.sin(2 * np.pi * 7.5 * t + 0.6 * np.sin(2 * np.pi * 2.1 * t))) ** 0.6
    y = filt(rng.normal(0, 1, len(t)), "bandpass", (2200, 7500)) * strokes
    y *= env_adsr(len(t), 0.02, 0.08)
    return y * vel


def cat_voice(dur, f_pts, formant_pts, amp_pts, trill=0.0):
    """Formant synthesis of a cat: harmonic source with a moving pitch arc through m-e-a-u formants."""
    t = ts(dur)
    u = t / dur
    f0 = np.interp(u, *zip(*f_pts))
    f0 = f0 * (1 + 0.012 * np.sin(2 * np.pi * 6.5 * t) + 0.004 * filt(rng.normal(0, 1, len(t)), "lowpass", 30))
    ph = 2 * np.pi * np.cumsum(f0) / SR
    fu = [p[0] for p in formant_pts]
    F = [np.interp(u, fu, [p[1][i] for p in formant_pts]) for i in range(3)]
    B = [180, 260, 380]
    G = [1.0, 0.75, 0.35]
    y = np.zeros_like(t)
    for k in range(1, 26):
        fk = k * f0
        env = sum(g / (1 + ((fk - Fi) / (b / 2)) ** 2) for Fi, b, g in zip(F, B, G))
        y += (k ** -1.15) * env * np.sin(k * ph) * (fk < 11000)
    asp = filt(rng.normal(0, 1, len(t)), "bandpass", (2500, 6500)) * 0.03
    a = np.interp(u, *zip(*amp_pts))
    if trill:
        a *= 0.65 + 0.35 * np.sin(2 * np.pi * trill * t)
    return norm((y + asp) * a)


def meow(scale=1.0):
    return cat_voice(
        0.62,
        [(0, 520 * scale), (0.32, 790 * scale), (0.7, 600 * scale), (1, 430 * scale)],
        [(0, (420, 1500, 3200)), (0.12, (700, 2350, 3700)), (0.45, (1250, 2050, 3600)), (0.8, (800, 1350, 3200)), (1, (600, 1100, 3000))],
        [(0, 0), (0.06, 0.25), (0.16, 0.9), (0.55, 1.0), (0.85, 0.55), (1, 0)],
    )


def mrrp():
    return cat_voice(
        0.3,
        [(0, 430), (0.5, 640), (1, 560)],
        [(0, (500, 1400, 3000)), (0.5, (950, 1900, 3400)), (1, (700, 1300, 3100))],
        [(0, 0), (0.15, 0.8), (0.7, 1.0), (1, 0)],
        trill=27,
    )


# ---------------------------------------------------------------- reverb
def make_ir(length=2.4, predelay=0.018, damp=(0.9, 0.55, 0.28)):
    t = ts(length)
    out = []
    for ch in range(2):
        nz = rng.normal(0, 1, len(t))
        lo = filt(nz, "lowpass", 900) * np.exp(-t / damp[0])
        mid = filt(nz, "bandpass", (900, 4000)) * np.exp(-t / damp[1])
        hi = filt(nz, "highpass", 4000) * np.exp(-t / damp[2])
        ir = lo + mid + hi
        ir *= np.minimum(1, t / 0.012)
        ir = np.concatenate([np.zeros(int(predelay * SR)), ir])
        out.append(ir / np.sqrt(np.sum(ir ** 2)))
    return np.array(out)


def reverb(bus_x, ir):
    return np.vstack([fftconvolve(bus_x[c], ir[c])[:N] for c in range(2)])


# ---------------------------------------------------------------- arrangement
C = CUES
drums, claps, music, drone, bass, sfx, bells = (Bus() for _ in range(7))
kick_times = []
clap_times = []
dholak_times = []

# chords (MIDI voicings around D4) per bar start time
Dm = [50, 57, 62, 65, 69]
Cmaj = [48, 55, 60, 64, 67]
Gmaj = [43, 55, 59, 62, 67]
Amaj = [45, 57, 61, 64, 69]
ROOTS = {"Dm": 38, "C": 36, "G": 43, "A": 45}

# tanpura: Pa - Sa - Sa - low Sa, the whole piece
t = 0.0
cycle = [midi(45), midi(50), midi(50), midi(38)]
while t < DUR:
    for i, f in enumerate(cycle):
        tt = t + i * 0.62
        if tt < DUR:
            drone.add(tanpura(f, int(t / 3.1) % 2), tt, gain=0.55 if i < 3 else 0.7, pan=[-0.45, 0.35, 0.5, -0.2][i])
    t += 3.1

# --- INTRO 0-4: harmonium swell + bansuri aalaap, cat
swell = harmonium_chord(Dm, 3.9)
music.add(swell * np.linspace(0.0, 1.0, len(swell)) ** 1.5, 0.15, gain=0.33, pan=-0.1)
# bansuri aalaap enters after the meow and resolves to Sa exactly on the drop
music.add(flute_phrase([(0.0, 81, 0.85), (0.85, 79, 0.25), (1.1, 77, 0.25), (1.35, 76, 0.45), (1.8, 77, 0.2),
                        (2.0, 76, 0.35), (2.35, 74, 0.7)]), C["drop"] - 3.05, gain=0.42, pan=0.12)
sfx.add(pop(1100, 480), C["catPop"], gain=0.5)
sfx.add(meow(), C["meow1"], gain=0.62, pan=-0.05)
sfx.add(pop(1300, 600, 0.6), C["bubble1"], gain=0.35, pan=0.25)
sfx.add(bell(midi(98), 0.9), C["glint"], gain=0.08, pan=0.1)
sfx.add(pop(1400, 650, 0.6), C["bubble2"], gain=0.35, pan=0.25)
sfx.add(noise_sweep(2.0, 250, 9000, "rise", pan_from=-0.3, pan_to=0.3), C["riser"], gain=0.3)
# swarmandal sweep up into the drop
scale = [62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84, 86]
for i, m in enumerate(scale):
    music.add(santoor(midi(m), 2.2, 0.7), 3.45 + i * 0.026, gain=0.11, pan=-0.7 + 1.4 * i / len(scale))
# tirakita roll accelerating into sam
for k, tt in enumerate([3.5, 3.625, 3.75, 3.8125, 3.875, 3.9375]):
    drums.add(dholak_treble(0.45 + 0.1 * k, open_=k % 2 == 0), tt, gain=0.5, pan=0.15)
sfx.add(noise_sweep(0.55, 400, 5000, "whoosh"), C["zoom"] - 0.05, gain=0.32)


# --- groove builders
def groove_bar(t0, intensity=1.0, claps_full=False, kick_on=True):
    # kehrwa: Dha Ge Na Ti | Na Ka Dhi Na
    pat = ["dha", "ge", "na", "ti", "na", "ka", "dhi", "na"]
    for i, s in enumerate(pat):
        tt = hum(t0 + i * E8)
        v = intensity * (1.0 if i in (0, 6) else 0.75)
        if s in ("dha", "dhi"):
            drums.add(dholak_bass(v, bend=1.25), tt, gain=0.55, pan=-0.1)
            drums.add(dholak_treble(v), tt, gain=0.42, pan=0.15)
        elif s == "ge":
            drums.add(dholak_bass(v * 0.7, bend=1.35, f0=78), tt, gain=0.45, pan=-0.1)
        elif s == "na":
            drums.add(dholak_treble(v * 0.9), tt, gain=0.38, pan=0.15)
        elif s == "ti":
            drums.add(dholak_treble(v * 0.55, open_=False), tt, gain=0.34, pan=0.2)
        elif s == "ka":
            drums.add(ka(v * 0.8), tt, gain=0.38, pan=-0.15)
        dholak_times.append(round(tt, 4))
        # ghost sixteenths for lilt
        if i in (3, 7) and intensity > 0.9:
            drums.add(dholak_treble(0.3, open_=False), hum(t0 + i * E8 + S16), gain=0.3, pan=0.25)
    for i in range(16):
        acc = 1.0 if i % 4 == 0 else (0.55 if i % 2 == 0 else 0.35)
        bells.add(ghungroo(acc * min(intensity, 1.0)), hum(t0 + i * S16), gain=0.16, pan=0.45 if i % 2 else 0.25)
    if kick_on:
        for b in (0, 2):
            kick_times.append(t0 + b * BEAT)
            drums.add(kick(intensity), t0 + b * BEAT, gain=0.72)
    hits = [0, 2, 4, 6] if claps_full else [2, 6]
    for i in hits:
        taali(claps, t0 + i * E8, vel=1.0 if i in (2, 6) else 0.8, people=9 if claps_full else 6)
        clap_times.append(t0 + i * E8)
    taali(claps, t0 + 7 * E8, vel=0.55, people=5)
    clap_times.append(t0 + 7 * E8)


def bass_bar(t0, root, intensity=1.0):
    r = midi(root)
    for off, dur, mult in [(0, 1.5, 1), (3, 0.8, 1), (4, 1.4, 1), (7, 0.8, 1.5)]:
        bass.add(bass_note(r * mult, dur * E8, intensity), t0 + off * E8, gain=0.5)


def harmonium_stabs(t0, chord, vel=0.8):
    for off in (1, 3, 5, 7):
        music.add(harmonium_chord(chord[1:], 0.16, vel), t0 + off * E8, gain=0.16, pan=-0.25)


def hook(t0, notes, flute_gain=0.34, harm_gain=0.2):
    """Melody: bansuri on top, harmonium doubling an octave below (qawwali-style unison lead)."""
    music.add(flute_phrase(notes), t0, gain=flute_gain, pan=0.15)
    for s, m, d in notes:
        music.add(harmonium_note(midi(m - 12), d + 0.02, 1.0), t0 + s, gain=harm_gain * 0.18, pan=-0.2)


def eighths(seq):
    out, t = [], 0.0
    for m, n in seq:
        if m is not None:
            out.append((t, m, n * E8 - 0.01))
        t += n * E8
    return out


HOOK_A = eighths([(74, 1), (76, 1), (77, 1), (79, 1), (81, 2), (79, 1), (77, 1),
                  (76, 1), (77, 1), (76, 1), (74, 1), (72, 1), (74, 3)])
HOOK_B = eighths([(74, 1), (76, 1), (77, 1), (79, 1), (81, 1), (83, 1), (81, 1), (79, 1),
                  (77, 1), (79, 1), (77, 1), (76, 1), (74, 4)])
CLIMAX = eighths([(81, 2), (86, 1), (84, 1), (83, 2), (81, 1), (79, 1),
                  (79, 1), (81, 1), (79, 1), (76, 1), (76, 1), (77, 1), (76, 1), (73, 1)])

# --- DROP 1 (4-8): hero
sfx.add(boom(), C["drop"], gain=0.55)
for bar, (chord, root) in enumerate([(Dm, "Dm"), (Cmaj, "C")]):
    t0 = C["drop"] + bar * 2
    groove_bar(t0)
    bass_bar(t0, ROOTS[root])
    harmonium_stabs(t0, chord)
hook(C["drop"], HOOK_A)
sfx.add(scribble(), C["underline"], gain=0.22, pan=-0.3)
for k, tt in enumerate([C["tag1"], C["tag2"], C["tag3"]]):
    drums.add(tabla_na(0.9, kind="na"), tt, gain=0.28, pan=0.3)
sfx.add(pop(1000, 500, 0.5), C["subtitle"], gain=0.25)
sfx.add(noise_sweep(0.6, 300, 6000, "whoosh", pan_from=0.5, pan_to=-0.5), C["toS3"] - 0.05, gain=0.3)

# --- 8-14: what I do
for bar, (chord, root) in enumerate([(Gmaj, "G"), (Dm, "Dm"), (Dm, "Dm")]):
    t0 = C["s3"] + bar * 2
    groove_bar(t0, intensity=0.95)
    bass_bar(t0, ROOTS[root])
    harmonium_stabs(t0, chord, 0.7)
hook(C["s3"], HOOK_B)
# santoor ostinato (Sa Pa Sa' Pa ...) under the cards
ost = [62, 69, 74, 69, 65, 69, 74, 77]
for i in range(48):
    tt = C["s3"] + i * S16
    if tt >= 13.5:
        break
    music.add(santoor(midi(ost[i % len(ost)] + 12), 0.9, 0.5), hum(tt), gain=0.07, pan=0.45 if i % 2 else -0.35)
music.add(flute_phrase([(0.0, 81, 0.45), (0.5, 79, 0.24), (0.75, 77, 0.24), (1.0, 76, 0.45), (1.5, 74, 0.5)]), 12.0, gain=0.3, pan=0.15)
music.add(harmonium_chord(Dm, 1.95, 0.7), 12.0, gain=0.14, pan=-0.2)
for key in ("card1", "card2", "card3"):
    sfx.add(thock(), C[key], gain=0.42)
    drums.add(tabla_na(1.0, kind="ta"), C[key], gain=0.25, pan=0.2)
sfx.add(mrrp(), C["catPeek"] + 0.12, gain=0.42, pan=0.45)
# fill into the breakdown
for k, tt in enumerate(np.arange(13.0, 13.5, S16)):
    drums.add(dholak_treble(0.5 + 0.08 * k, open_=k % 2 == 0), hum(tt), gain=0.4, pan=0.15)
sfx.add(noise_sweep(0.7, 300, 7000, "whoosh", pan_from=-0.4, pan_to=0.6), C["toS4"] - 0.05, gain=0.32)

# --- 14-18: perfectionist breakdown (drums drop out, clock-like ticks)
music.add(harmonium_chord(Dm, 3.0, 0.8), C["s4"], gain=0.2, pan=-0.1)
music.add(flute_phrase([(0.0, 74, 1.4), (1.5, 76, 0.5), (2.0, 77, 0.9)], vib_cents=20), C["s4"] + 0.05, gain=0.22, pan=0.2)
sfx.add(mouse_click(), C["cursorClick"], gain=0.4, pan=0.2)
for k, tt in enumerate(C["nudges"]):
    sfx.add(tick(2350 if k % 2 == 0 else 2650), tt, gain=0.3, pan=-0.25 if k % 2 == 0 else 0.25)
    drums.add(tabla_na(0.35, kind="tin"), tt, gain=0.2, pan=0.1)
    sfx.add(mouse_click(0.5), tt - 0.01, gain=0.18)
# 'perfect': swarmandal + bell over a bright G chord, resolving
for i, m in enumerate(scale + [88, 89, 91]):
    music.add(santoor(midi(m), 2.6, 0.7), C["perfect"] + i * 0.022, gain=0.12, pan=-0.7 + 1.4 * i / 18)
sfx.add(bell(), C["perfect"] + 0.02, gain=0.24, pan=0.1)
music.add(harmonium_chord(Gmaj, 0.95, 0.9), C["perfect"], gain=0.24, pan=-0.1)
sfx.add(thock(0.8), C["perfect"], gain=0.3)
for k, tt in enumerate(np.arange(17.5, 18.0, S16)):
    drums.add(dholak_treble(0.45 + 0.12 * k), hum(tt), gain=0.45, pan=0.15)
    drums.add(dholak_bass(0.3 + 0.1 * k, bend=1.3), hum(tt), gain=0.3)
sfx.add(noise_sweep(0.6, 300, 6000, "whoosh", pan_from=0.6, pan_to=-0.6), C["toS5"] - 0.05, gain=0.3)

# --- 18-22: friends (hook returns)
sfx.add(boom(0.6), C["s5"], gain=0.35)
for bar, (chord, root) in enumerate([(Dm, "Dm"), (Cmaj, "C")]):
    t0 = C["s5"] + bar * 2
    groove_bar(t0)
    bass_bar(t0, ROOTS[root])
    harmonium_stabs(t0, chord)
hook(C["s5"], HOOK_A, flute_gain=0.3)
for k, key in enumerate(("bub1", "bub2", "bub3")):
    sfx.add(pop(900 + 120 * k, 420 + 50 * k), C[key], gain=0.42, pan=0.3)
sfx.add(pop(1500, 700, 1.0), C["reply"], gain=0.5, pan=0.35)
sfx.add(pop(800, 380, 0.8), C["reply"] + 0.04, gain=0.3, pan=0.35)
sfx.add(thock(1.0), C["sticker"], gain=0.45, pan=-0.3)
for k, tt in enumerate(np.arange(21.5, 22.0, S16)):
    drums.add(dholak_treble(0.5 + 0.1 * k, open_=True), hum(tt), gain=0.45, pan=0.15)
    if k % 2 == 0:
        taali(claps, tt, vel=0.5 + 0.1 * k, people=6)
sfx.add(noise_sweep(1.2, 200, 9000, "rise"), 20.8, gain=0.22)

# --- 22-26: qawwali climax
sfx.add(boom(1.0), C["climax"], gain=0.55)
CLIMAX_CHORDS = [(Dm, "Dm", 0.0), (Gmaj, "G", 1.0), (Cmaj, "C", 2.0), (Amaj, "A", 3.0)]
for bar in range(2):
    groove_bar(C["climax"] + bar * 2, intensity=1.1, claps_full=True)
for chord, root, off in CLIMAX_CHORDS:
    t0 = C["climax"] + off
    for o, d in [(0, 1.5), (3, 0.8)]:
        bass.add(bass_note(midi(ROOTS[root]), d * E8, 1.1), t0 + o * E8, gain=0.5)
    music.add(harmonium_chord(chord, 0.98, 0.9), t0, gain=0.2, pan=-0.2)
hook(C["climax"], CLIMAX, flute_gain=0.4, harm_gain=0.32)
# santoor shimmer on the climax
for i in range(32):
    tt = C["climax"] + i * S16
    m = [74, 81, 86, 81][i % 4]
    music.add(santoor(midi(m), 0.8, 0.45), hum(tt), gain=0.05, pan=0.5 if i % 2 else -0.5)
sfx.add(noise_sweep(0.55, 400, 6000, "whoosh", pan_from=-0.5, pan_to=0.5), C["toS7"] - 0.05, gain=0.28)

# --- 26-30: outro with tihai landing on sam
sfx.add(boom(0.8), C["outro"], gain=0.45)
groove_bar(C["outro"], intensity=1.0, kick_on=True)
bass.add(bass_note(midi(38), 0.7, 1.0), C["outro"], gain=0.5)
music.add(harmonium_chord(Dm, 0.75, 0.9), C["outro"], gain=0.2, pan=-0.2)
music.add(flute_phrase([(0.0, 74, 0.7)]), C["outro"], gain=0.3, pan=0.15)
sfx.add(pop(1100, 520), C["cat1"], gain=0.35, pan=0.3)
sfx.add(pop(1200, 560), C["cat2"], gain=0.35, pan=0.3)
# tihai: (dha ti ta) x3 with one-sixteenth gaps; the last 'ta' lands on sam
tihai = []
for p in range(3):
    for s in range(3):
        tihai.append((C["tihai"] + (p * 4 + s) * S16, s))
assert abs(tihai[-1][0] - C["sam"]) < 1e-9
for tt, s in tihai[:-1]:
    v = 1.0 if s == 0 else 0.8
    drums.add(dholak_bass(v, bend=1.2), tt, gain=0.5)
    drums.add(dholak_treble(v), tt, gain=0.45, pan=0.15)
    drums.add(tabla_na(v, kind="na" if s == 0 else "ta"), tt, gain=0.25, pan=0.25)
    taali(claps, tt, vel=0.8 * v, people=7)
    clap_times.append(tt)
    dholak_times.append(tt)
# SAM: everything lands together
sam = C["sam"]
sfx.add(boom(1.1), sam, gain=0.6)
drums.add(kick(1.2), sam, gain=0.9)
kick_times.append(sam)
drums.add(dholak_bass(1.2, bend=1.15), sam, gain=0.6)
drums.add(dholak_treble(1.2), sam, gain=0.5)
taali(claps, sam, vel=1.2, people=9)
clap_times.append(sam)
final = harmonium_chord([38, 50, 57, 62, 65, 69, 74], 2.0, 1.0)
music.add(final * np.linspace(1, 0.0, len(final)) ** 0.6, sam, gain=0.3, pan=-0.1)
bass.add(bass_note(midi(38), 1.6, 1.1), sam, gain=0.55)
music.add(flute_phrase([(0.0, 81, 0.25), (0.25, 79, 0.25), (0.5, 74, 1.4)], vib_cents=22), sam + 0.02, gain=0.36, pan=0.15)
for i, m in enumerate(scale + [88, 89, 91, 93]):
    music.add(santoor(midi(m), 2.8, 0.6), sam + 0.03 + i * 0.024, gain=0.1, pan=-0.75 + 1.5 * i / 19)
sfx.add(meow(1.06), C["meow2"], gain=0.55, pan=-0.1)

# ---------------------------------------------------------------- mix
sc = np.ones(N)                                      # sidechain from the kick
for tk in kick_times:
    i = int(tk * SR)
    k = np.arange(N - i) / SR
    sc[i:] *= 1 - 0.38 * np.exp(-k / 0.11)
music.x *= sc
bass.x *= sc
drone.x *= 0.5 + 0.5 * sc

# rest the sub during the breakdown
gate = np.ones(N)
gate[int(14.0 * SR):int(17.5 * SR)] = 0.0
bass.x *= gate

hall = make_ir(2.6, 0.022)
room = make_ir(0.7, 0.008, damp=(0.25, 0.16, 0.08))
mix = (
    drums.x * 0.9 + claps.x * 3.4 + music.x * 1.25 + drone.x * 0.32 + bass.x * 0.75 + sfx.x * 1.0 + bells.x * 1.0
)
wet = reverb(music.x * 0.55 + drone.x * 0.25 + sfx.x * 0.3 + bells.x * 0.3, hall) * 0.32 + reverb(claps.x * 3.0 + drums.x * 0.4, room) * 0.2
mix = mix + wet
mix = np.vstack([filt(c, "highpass", 28) for c in mix])
# mastering EQ: tame sub, open up presence and air
mix = np.vstack([biquad(biquad(biquad(biquad(c, "lowshelf", 90, -2.5), "peak", 300, -1.5, 0.9), "peak", 2800, 2.5, 0.8), "highshelf", 7000, 3.5) for c in mix])

# glue compressor (feed-forward, RMS-ish)
lvl = np.max(np.abs(mix), axis=0)
peak = np.max(lvl)
mix /= peak
lvl = np.max(np.abs(mix), axis=0)
att, rel = np.exp(-1 / (0.01 * SR)), np.exp(-1 / (0.15 * SR))
envl = np.empty(N)
e = 0.0
for i in range(N):
    v = lvl[i]
    e = att * e + (1 - att) * v if v > e else rel * e + (1 - rel) * v
    envl[i] = e
thr = 0.35
gain = np.where(envl > thr, (thr / np.maximum(envl, 1e-9)) ** (1 - 1 / 2.2), 1.0)
mix *= gain

def lufs(x):
    """Integrated loudness per ITU-R BS.1770-4 (K-weighting + gating)."""
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    k = np.vstack([lfilter(b2, a2, lfilter(b1, a1, c)) for c in x])
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    ms = np.array([np.mean(k[:, i:i + blk] ** 2, axis=1).sum() for i in range(0, k.shape[1] - blk, hop)])
    L = -0.691 + 10 * np.log10(ms + 1e-12)
    ms = ms[L > -70]
    rel = -0.691 + 10 * np.log10(ms.mean()) - 10
    ms = ms[-0.691 + 10 * np.log10(ms) > rel]
    return -0.691 + 10 * np.log10(ms.mean())


def limit(x, ceiling):
    """Look-ahead peak limiter on a 4x-oversampled peak estimate (keeps true peak under the ceiling)."""
    look = int(0.003 * SR)
    up = np.max(np.abs(np.vstack([resample_poly(c, 4, 1) for c in x])), axis=0).reshape(-1, 4).max(axis=1)[: x.shape[1]]
    lvl = np.maximum(up, np.max(np.abs(x), axis=0))
    req = minimum_filter1d(np.minimum(1.0, ceiling / np.maximum(lvl, 1e-9)), size=2 * look + 1)
    g = np.empty(N)
    cur = 1.0
    r = np.exp(-1 / (0.08 * SR))
    for i in range(N):
        cur = req[i] if req[i] < cur else r * cur + (1 - r) * req[i]
        g[i] = cur
    return x * g


TARGET, CEIL = -14.0, 10 ** (-1.2 / 20)
pre = mix.copy()
gain_db = TARGET - lufs(pre)
for _ in range(3):
    mix = limit(pre * 10 ** (gain_db / 20), CEIL)
    gain_db += TARGET - lufs(mix)
print(f"loudness {lufs(mix):.2f} LUFS")
# fade the very end to digital silence
fade = int(0.35 * SR)
mix[:, -fade:] *= np.linspace(1, 0, fade) ** 2

args = [a for a in sys.argv[1:] if not a.startswith("--")]
out = Path(args[0] if args else ROOT / "build")
out.mkdir(parents=True, exist_ok=True)
wavfile.write(out / "soundtrack.wav", SR, mix.T.astype(np.float32))
if "--stems" in sys.argv:
    for name, b in [("drums", drums), ("claps", claps), ("music", music), ("drone", drone), ("bass", bass), ("sfx", sfx), ("bells", bells)]:
        wavfile.write(out / f"stem-{name}.wav", SR, (b.x.T / peak).astype(np.float32))


# ---------------------------------------------------------------- levels for the visuals
fps = CUES["fps"]
hop = SR // fps
mono = mix.mean(axis=0)
frames = int(DUR * fps)
nfft = 4096
win = np.hanning(nfft)
edges = np.geomspace(40, 12000, 17)
freqs = np.fft.rfftfreq(nfft, 1 / SR)
bands = np.zeros((frames, 16))
for f in range(frames):
    c = f * hop
    seg = mono[max(0, c - nfft // 2): c + nfft // 2]
    if len(seg) < nfft:
        seg = np.pad(seg, (0, nfft - len(seg)))
    spec = np.abs(np.fft.rfft(seg * win))
    for b in range(16):
        m = (freqs >= edges[b]) & (freqs < edges[b + 1])
        bands[f, b] = np.sqrt(np.mean(spec[m] ** 2)) if m.any() else 0
bands = np.log1p(bands)
bands /= np.percentile(bands, 98, axis=0, keepdims=True) + 1e-9
bands = np.clip(bands, 0, 1)
sm = np.zeros_like(bands)
for f in range(frames):
    prev = sm[f - 1] if f else 0
    sm[f] = np.where(bands[f] > prev, bands[f], prev * 0.82 + bands[f] * 0.18)
(out / "levels.json").write_text(json.dumps({
    "fps": fps,
    "bands": np.round(sm, 3).tolist(),
    "kicks": sorted(round(x, 4) for x in kick_times),
    "claps": sorted(set(round(x, 4) for x in clap_times)),
}))
print(f"wrote {out/'soundtrack.wav'}  peak={np.max(np.abs(mix)):.3f}")
