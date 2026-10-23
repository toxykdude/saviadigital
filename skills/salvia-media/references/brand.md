# Salviadigital Brand & Media Reference

Single source of truth for on-brand media generation. Keep in sync with the live site.

## Company

- **Name**: Salviadigital — `https://salvia.digital` (GitHub Pages, repo `toxykdude/saviadigital`, branch `main`, root deploy)
- **What**: Digital innovation agency — drones, laser advertising, web development, AI automation/chatbots, social content engines.
- **Market**: Spanish-speaking (es-CO), Colombia, B2B + small/medium businesses. Premium-tech positioning, prices in COP (IVA incluido).

## Paid services (products)

| Key | Service | Price COP |
|---|---|---|
| landing | Landing Page de Conversión | $1.490.000 |
| chatbot | Agente IA / Chatbot | $1.990.000 |
| laser | Campaña de Publicidad Láser | $4.900.000 |
| tour360 | Tour Virtual 360° con Dron | $1.290.000 |

Payments via mipago.online.

## Visual identity

- Ground: near-black `#060809`; surfaces `var(--bg2)`; lines `var(--line)`.
- Accent: emerald green `#2CF59B` (links, prices, tags, glows).
- Typography: mono tags uppercase with wide letter-spacing; display font for headings.
- Imagery contract: dark cinematic grade, emerald/teal accents, high contrast, must look good in **grayscale** (cards render `grayscale(1) brightness(.72)` until hover → full color + 1.045 scale).
- Ratios: 16:9 for cards/modals (grid uses `object-fit:cover`, modal ≈ 1000×540).

## Subject map (portfolio cases → visual concept)

| id | Client / Service | Concept |
|---|---|---|
| resort | Costa Azul Resorts · DRONES | Aerial dusk luxury resort, glowing infinity pools, ocean |
| vantia | Grupo Vantia · LÁSER | Green laser mapping on glass tower, crowd silhouettes |
| nordika | Nordika Inmobiliaria · WEB | Hand holding phone, real-estate app + map pins |
| aural | Clínica Dental Aural · AUTOMATIZACIÓN | Phone with green/white chat bubbles, clinic lobby |
| roble | Finca El Roble · DRONES | Top-down crop-field geometry, drone nav lights |
| vertice | Vértice Consultores · AUTOMATIZACIÓN | Emerald node-graph hologram over laptop, night office |
| aurora | Tienda Aurora · REDES | Fashion studio, floating multi-channel content panels |

## Prompt library (proven patterns)

Base pattern — subject + "dark cinematic" + "emerald accents" + grade + "no text" (mandatory for anything with UI):

- **Aerial/place**: "Cinematic aerial drone photograph of {subject} at dusk: …, deep teal and emerald color grade, moody dark cinematic lighting, high contrast, professional campaign photography, no text"
- **UI on screen**: "…smartphone displaying a sleek dark-mode {app} interface, abstract blurred interface with no readable text, soft emerald accent lighting, shallow depth of field, dark moody tech aesthetic"
- **Chat/AI agent**: "…screen glowing with an abstract green chat conversation of soft rounded message bubbles with no readable text…"
- **Hologram/data**: "…floating holographic {pipeline/dashboard} of glowing emerald nodes and connecting lines, abstract data with no readable text, dark office at night…"

## Video briefs (marketing)

- Pipeline: `generate_video` image-to-video, `startFrame.taskId` = Runway task of an APPROVED still (720p for finals, audio on for ambient).
- Motion prompt = camera move + environmental motion + keep grade ("slow cinematic aerial drift… smooth stabilized gimbal motion, premium campaign feel, ambient sound").
- **Anti-warp pattern (mandatory for drone/architecture footage)**: distant high-altitude framing, "very slow" drift, "minimal parallax", "rigid architecture with clean straight lines holds its shape", "calm glassy reflections", "still palm trees". Close-up low-altitude push-ins over pools/palms FAILED review (morphing edges, swimming foliage) on 2026-10-23; the distant-framing rewrite PASSED clean.
- Review with `zai-mcp-server.analyze_video`: subject match, motion artifacts (warping, flicker, morphing, swimming textures), grade consistency, PASS/FAIL.
- Credits (2026-10): 10s 720p seedance-2 ≈ 300 credits; 5s 480p seedance-2-fast ≈ 55 credits (quality was review-clean at test scale). Check `whoami` before planning a batch.

## Pipeline & gotchas

1. Runway MCP `generate_image` (default model, 16:9, 1K) → 2. Z.ai review (SERIAL — parallel calls rate-limit with HTTP 429; retry after a pause) → 3. WebP q80 `method=6` via PIL (10.7MB → 575KB for 7 images) → 4. `assets/projects/<id>.webp` → 5. commit/push → live in ~45s.
- Runway signed artifact URLs (CloudFront `?_jwt=`) — never retype by hand; use task IDs (`get_task` resolves URLs) or write-then-curl.
- Before generating: `whoami` for credits/models. Video is credit-hungry (~300 credits for a 10s 720p clip).
- Z.ai 4-point review: (1) SUBJECT clear match? (2) ARTIFACTS — hands/faces/gibberish text/warps? list readable text found (3) AESTHETIC — dark cinematic, fits near-black UI? (4) VERDICT — PASS/FAIL + one line.
- Accepted imperfections (2026-10 review): pseudo-text in tiny hologram labels (vertice), panel count ≠ literal channel count (aurora). Fine at card scale.
