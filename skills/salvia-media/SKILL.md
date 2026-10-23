---
name: salvia-media
description: "Trigger: salvia image, salvia video, marketing asset, campaign, portfolio imagery, brand visual, hero image, salvia.digital media. Generate and review on-brand media for Salviadigital."
license: Apache-2.0
metadata:
  author: "toxykdude"
  version: "1.0"
---

# Salviadigital Media

## Activation Contract

Load before creating, reviewing, or selecting ANY image, video, or audio asset for Salviadigital (salvia.digital): portfolio cards, hero images, marketing campaigns, social clips. Also load when a generated asset looks off-brand.

## Hard Rules

- Read `references/brand.md` FIRST — it holds the identity, palette, subject map, and prompt library.
- Visual identity is non-negotiable: near-black `#060809` ground, emerald `#2CF59B` accent, dark cinematic grade.
- Every still must read well DESATURATED (site shows grayscale until hover).
- NO readable text in generated imagery. UI/chat shots use abstract blank bubbles/cards — gibberish text is the #1 AI giveaway.
- Review EVERY asset with `zai-mcp-server.analyze_image` (or `analyze_video`) before shipping. PASS required; regenerate on FAIL.
- Never retype Runway signed URLs (`?_jwt=…`) by hand into shell — corrupted JWT returns "Invalid JWT". Write full URLs to a script file with the write tool, or `fetch()` inside code-mode to validate.
- Site/marketing copy is Spanish (es-CO). Generated artifacts follow brand.md specs.

## Decision Gates

| Need | Action |
|---|---|
| Portfolio/hero still | `runway.generate_image`, 16:9, dark cinematic + emerald + "no readable text" |
| Campaign video | `runway.generate_video` image-to-video from an APPROVED still (pass its Runway `taskId` as `startFrame`) |
| Quality gate | `zai analyze_image` / `analyze_video`, one at a time (parallel calls hit HTTP 429) |
| Ship a still | Convert PNG → WebP q80 (PIL `method=6`); never commit multi-MB PNGs |
| Motion brief | Describe camera + scene motion only; keep the still's grade |

## Execution Steps

1. Load `references/brand.md`; pick the subject from the subject map.
2. Generate via Runway MCP (default image model; seedance family for video).
3. Review via Z.ai MCP against the 4-point check (subject / artifacts / aesthetic / verdict) in brand.md.
4. Optimize stills to WebP; store under `assets/projects/` (or `assets/campaigns/`).
5. Commit, push — GitHub Pages auto-rebuilds; verify HTTP 200 on the live URL.

## Output Contract

Deliver: asset file path(s), Z.ai verdict per asset, live URL check, and credit balance note if low.

## References

- `references/brand.md` — Salviadigital identity, palette, subject map, prompt library, pipeline gotchas.
