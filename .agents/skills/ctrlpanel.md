---
name: ctrlpanel
description: >
  Resume building CTRLpanel — Cameron McCann's personal Life OS.
  Use when continuing development on any CTRLpanel module or feature.
---

# CTRLpanel Resume Skill

When this skill is invoked:

1. Read `AGENTS.md` — full project spec, design system, build order, and rules
2. Read `MASTER_CONTROLLER_PROMPT.md` — Claude AI integration details
3. Scan `/src/pages/` to see which pages already exist
4. Scan `/src/components/` to see which components already exist
5. Check the build order in AGENTS.md and identify the next incomplete page
6. Continue building from exactly where the project left off
7. Never break or overwrite working code
8. Apply the full design system (glass-morphism, red accent, Inter font) consistently
9. Use mock data for any page whose real API connection isn't wired yet

## Quick Reference
- Stack: React + Vite frontend, Node/Express backend, Supabase DB, Claude AI
- Design: Dark (#0a0808 bg), red accent (#e11d48), glass-morphism cards, Inter font
- No Tailwind. No component libraries. Pure CSS only.
- All DB calls through /src/lib/supabase.js
- All AI calls through /backend/claude.js
