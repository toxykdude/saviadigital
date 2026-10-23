# Salviadigital Post-Production (ffmpeg)

Adapted from hermes CT100 validated campaign scripts (Aug–Oct 2026). All recipes assume 720p (1280×720 landscape / 720×1280 vertical), 24 fps, 48 kHz mono→stereo audio.

## Captions (burned-in, Spanish)

- Font: Teko-Bold for punchy hooks (check `/root/.fonts` or `fonts/` in workspace; download from Google Fonts if missing). Headline white, accent word emerald `#2CF59B`.
- **Colons/special chars break drawtext filtergraphs** ("5:42 A.M.", "TU WEB:") — always use `textfile=$(mktemp)` written with printf, zero escaping.
- **Auto-fit is mandatory**: fixed fontsize overflows the frame on long Spanish lines. Measure with PIL `ImageFont.textbbox()` in ABSOLUTE coords and shrink fontsize by steps of 2 until width ≤ safe limit (≤690px on 720-wide verticals, ≤1240px on 1280-wide landscape) BEFORE passing to drawtext. Verify the computed value is actually used in the final command (once computed, drawtext stayed hardcoded).
- Caption bands: burned subs go in the 55%→bottom zone; keep ≥90px from bottom edge on verticals (UI overlap).

## Assembly (multi-clip with xfade)

- Normalize every clip BEFORE concat/xfade: `scale=720:1280,fps=24,settb=AVTB` — and NOTHING after settb (`setpts` after `settb` breaks xfade: "current rate 1/0 invalid"). Order matters: fps AFTER trim.
- Endcards/HTML renders often exit 1080×1920@30fps — scale AND fps-convert them to match before xfade.
- Dissolve: `xfade=transition=dissolve:duration=0.5:offset=<computed>`.
- Final audio: single stream 48kHz; music bed at ~0.85 with `sidechaincompress` ducking (~0.22) under speech/VO if present. Model-generated audio = ambience only — always lay a licensed/approved music bed for final cuts.

## Glitch cut (hide a defective frame span)

When a generation artifact appears on an otherwise-good clip (v1 fail taught us artifacts happen), cut the span and cover the hard cut with a 0.5s glitch junction:

```
rgbashift=rh=-10:bh=10:gv=-6,noise=alls=22:allf=t+u,eq=saturation=1.5:contrast=1.2
```

applied over the last 0.25s of clip A + first 0.25s of clip B, concat, `acrossfade=0.15`. Caption drawtext goes AFTER the glitch so text stays clean. Cheaper than a re-render when time matters — but prefer regeneration for headline shots (owner-facing).

## Endcards

- 1.5–2.5s, near-black `#060809` ground, emerald CTA pill + logo lockup. Build as HTML/gsap (or PIL) render, then scale/fps-convert per assembly rules.
- Lockup (logo + URL) stacks ABOVE the CTA row — bottom-corner placement collides with the button band. Pixel-scan: lockup must end ≥30px above CTA top; vision models call 9px gaps "touching", so scan coordinates, don't trust eyeballs or vision QA for clearance.

## QA gates (each one caught a real defect)

1. **Full decode**: `ffmpeg -v error -i <file> -f null -` — catches silent download corruption.
2. **Caption bounds**: PIL-measured widths within safe zones (see auto-fit).
3. **Vision review**: Z.ai `analyze_video` — subject, motion artifacts (warp/morph/flicker/pass-through), grade consistency, verdict PASS/FAIL. Regenerate on FAIL; glitch-cut only minor spans.
4. **Pixel checks beat vision judgments** for geometry (panel bounds, clearance, opacity) — scan, don't estimate.
5. Owner approval gate before batch production and before anything public with prices.

## Delivery

- Final cuts: `assets/campaigns/<campaign-name>/` in the saviadigital repo, committed and pushed; verify HTTP 200 on `https://salvia.digital/assets/campaigns/...`.
- Naming: `<campaign>-<variant>-v<N>-<pass|fail>.mp4`; keep FAILED takes locally, never commit them.
- Report file path + live URL as text. Videos are never chat attachments.
