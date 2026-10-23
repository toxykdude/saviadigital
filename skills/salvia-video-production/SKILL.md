---
name: salvia-video-production
description: "Trigger: salvia video, reel, teaser, campaign video, video ad, shorts, animate still. Produce Salviadigital campaign videos end-to-end."
license: Apache-2.0
metadata:
  author: "toxykdude"
  version: "1.0"
---

# Salviadigital Video Production

## Activation Contract

Load for ANY Salviadigital video work: campaign teasers, reels/shorts, animating approved stills, video ads, post-production/assembly. Identity basics live in `salvia-media`; this skill owns the video pipeline. Adapted 2026-10 from the validated PowerHouse suite (hermes CT100) — provenance and model-level pitfalls carried over, brand layer rewritten for Salviadigital.

## Hard Rules

1. Identity: near-black `#060809`, emerald `#2CF59B` accent, dark cinematic grade. Load `../salvia-media/references/brand.md` for palette/subjects.
2. Scenes NEVER contain text/logos — no-text incantation verbatim (see generation playbook). All copy, logo, prices composite in post.
3. Generate from APPROVED stills only: `generate_video` with `startFrame.taskId` of a Z.ai-PASSED image. Never animate an unreviewed still.
4. Owner approval gate: produce ONE sample → STOP → approval → only then produce the batch. Any asset showing prices requires explicit owner sign-off (prices from the PRICING array only — never invent).
5. Review every final with `zai-mcp-server.analyze_video` (subject / motion artifacts / grade / verdict). PASS required.
6. Max 3 video tasks per batch (workspace quota); poll with `get_task` every 60–90s; after a submit timeout, check the task exists before resubmitting (duplicates bill twice).
7. 4K costs ~4× — only on explicit request. Tests default 480p/5s.
8. Deliver videos as repo path + live URL (`assets/campaigns/`), never as chat attachments.

## Decision Gates

| Need | Path |
|---|---|
| Teaser/hero clip | Approved still → i2v → Z.ai review → `assets/campaigns/` |
| Multi-scene spot (3–5 shots) | `generate_multishot_video`, per-shot prompts from subject map |
| Edit existing footage | `generate_video` + `referenceVideo` (+ `durationSeconds`); surgical → `edit_video` if available |
| VO / narration | Runway speech tools (eleven family) — es-CO voice |
| Captions / assembly / music | `references/post-production.md` ffmpeg recipes |
| Posting / scheduling | Not yet wired for Salviadigital — ask owner; see playbook §scheduling notes |

## Execution Steps

1. Load `references/generation-playbook.md`; pick subject + scene template from brand map.
2. Confirm approved still (or generate + review one first via `salvia-media`).
3. Generate video — anti-warp and motion constraints from the playbook are mandatory.
4. Download (exact JWT URLs — write to script file, never hand-retype), verify with full decode.
5. Post-produce per `references/post-production.md` (captions, endcard, music, assembly).
6. Z.ai review → PASS → commit `assets/campaigns/<campaign>/` → push → verify live URL.

## Output Contract

Deliver: file path(s) + live URL(s), Z.ai verdict per asset, credit balance, and what remains owner-gated.

## References

- `references/generation-playbook.md` — models, prompt DNA, motion constraints, pitfalls.
- `references/post-production.md` — captions, endcards, xfade assembly, glitch cuts, QA.
