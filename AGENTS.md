# Salviadigital agents

Site: https://salvia.digital · GitHub Pages from `main` (root deploy) · Push to deploy (~45s rebuild).

## Skills

- `salvia-media` — load `skills/salvia-media/SKILL.md` before generating, reviewing, or selecting any image, video, or audio asset for this project (portfolio imagery, marketing campaigns, hero visuals).

## Repo notes

- `index.html` is the whole site (single-file, inline CSS/JS, no build step).
- Portfolio data lives in the `PROJECTS` array; images in `assets/projects/<id>.webp`.
- Never commit multi-MB PNGs — ship WebP (q80) stills.
- Secrets stay out of git (`.env` is ignored; production keys live in the ops-box).
