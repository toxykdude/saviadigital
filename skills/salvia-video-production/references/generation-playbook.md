# Salviadigital Video Generation Playbook

Adapted from hermes CT100 `powerhouse-video-templates` + `runway-mcp-powerhouse` (validated Aug–Oct 2026), merged with Salviadigital's own 2026-10 lessons. Provider here is Runway MCP (canonical); Higgsfield `seedance_2_5` CLI exists on hermes (ssh xeon → pct exec 100) as fallback if credits run out.

## Canonical flow (maximum brand consistency)

1. Generate on-brand still via `generate_image` (per `salvia-media` prompt library), review with Z.ai.
2. `generate_video` image-to-video, `startFrame.taskId` = the still's Runway task — the still already carries identity.
3. Minimal, on-brand motion (see constraints). Seedance does NOT render fine mechanical actions (pins, dials, typing) — use gross motor motion only.

## Scene templates (map to Salviadigital services)

| Template | Aspect | Scene |
|---|---|---|
| aerial_reveal | 16:9 | Distant high-altitude drift over resort/terrain (DRONES) |
| laser_show | 16:9 | Laser mapping sweeping across building facade at night (LÁSER) |
| ui_showcase | 16:9 / 9:16 | Slow push on phone/laptop with abstract UI glow (WEB) |
| agent_chat | 9:16 | Floating chat bubbles forming/aggregating, no faces (AUTOMATIZACIÓN) |
| field_scan | 16:9 | Top-down crop rows with scanning light pass (DRONES agro) |
| content_studio | 9:16 | Fashion studio, panels assembling (REDES) |
| cta_endcard | any | 1.5–2.5s near-black `#060809` + emerald CTA — composited in post, never generated |

## Motion constraints (each one fixed a real failure)

- **Anti-warp (Salviadigital 2026-10)**: distant framing, "very slow drift, minimal parallax, rigid architecture with clean straight lines holds its shape, calm glassy reflections". Close low-altitude push-ins over pools/palms morphed geometry.
- **Pass-through**: bodies/objects can cross through each other. Fix: assign explicit physical positions ("the drone resting solidly on its landing pad") + "every movement physically solid, bodies and equipment never intersect or pass through each other".
- **Temporal compression**: multiple actions in one prompt get juxtaposed illogically. Fix: "first X… then, only after X is complete, Y" and drop non-essential intermediate actions.
- **Content-filter bounce**: close-up faces + genre vocabulary (noir, interrogation) trips filters even when softened — reframe without faces (behind-the-shoulder, hands-only). Wide shots of the same theme pass.

## Prompt DNA (video)

```
[Camera move: very slow cinematic aerial drift / smooth gimbal push] +
[scene from brand map, on-brand grade: dark cinematic, teal/emerald accents] +
[motion constraints above] + "premium campaign feel, ambient evening sound"
```

Reference role map (pass by taskId, NEVER hand-copy signed URLs):
- Portfolio stills: resort `e584f495-d0af-4152-bf9d-4613acf533cf` · vantia `f8162942-f701-46ec-9266-6f1ed19deb49` · nordika `6abff7b4-ac97-48b3-9a13-fa63e3b2a6af` · aural `36d10475-c530-48bd-b49f-f46be8d4c836` · roble `f9fc0254-112f-4e36-9230-18d5c83a183e` · vertice `fd431262-17cd-47b0-bfde-e9aaf72b99dc` · aurora `6bca7b1f-7728-47dd-869a-f89bf9c45002`
- Public fallback URLs: `https://salvia.digital/assets/projects/<id>.webp`

## No-text incantation (verbatim, on every generation)

```
The image contains no text of any kind: no words, no letters, no captions,
no logos, no watermarks — only the photograph.
```

Exception: none for video. Logo/CTA/endcard are ALWAYS post-production composites; never pass a logo as a reference image to the model (it corrupts the scene).

## If embedded text is ever needed (posters/plates — not video)

- Verified for es-CO incl. accents: `gpt-image-2`/`gpt-image-2.5`, `nano-banana-2.1`. `ideogram` garbles Á/Ø/cedilla — banned for embedded Spanish.
- List exact strings at the end of the prompt: "Every Spanish word spelled exactly as quoted: [list]". QA by transcribing the headline glyph-by-glyph, not eyeballing.
- **Single-edit chains (golden rule)**: NEVER request several changes in one edit or combine poster + extra references — the model re-imagines the whole scene. One change per edit, each edit referencing the previous output, max 1 extra reference (the real logo) and only at the logo step.

## Task lifecycle & quotas

- Submit → `task_pending` + taskId. Videos take 3–10 min. Poll `get_task` every 60–90s.
- MCP timeout on submit ≠ failure: verify via `list_recent`/`get_task` before resubmitting — duplicates bill twice.
- Workspace quota: after ~3 video tasks in a day the workspace may reject new ones even with idle tasks — deliver what's produced and schedule the rest; don't retry in a loop.
- Credits (2026-10): 10s 720p seedance-2 ≈ 300 · 5s 480p seedance-2-fast ≈ 55 · images 1K ≈ 20. Check `whoami` before planning. 4K ≈ 4× 1080p.
- Downloads: copy JWT URLs EXACTLY (one changed char → "Invalid JWT"); safest is writing the full URL to a script file or fetching in code-mode to validate. Verify MP4s with full decode (`ffmpeg -v error -i f -f null -`) before cutting — proxy downloads can corrupt silently.

## Scheduling notes (roadmap — not yet wired)

When Salviadigital gets social channels: source posting hours from IG media insights per post (FB page hourly insights are deprecated/empty). Never reuse footage across assets — keep a source→asset registry. A/B rule: keep layout/price/CTA constant, vary exactly one variable (headline OR subject).
