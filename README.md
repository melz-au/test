# Flytype

React (Vite + TypeScript) rebuild of [flytype.webflow.io](https://flytype.webflow.io), with a Markdown blog.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in dist/
```

## Writing blog posts

Every Markdown file in `src/content/blog/` is a blog post. Its file name is the URL:
`src/content/blog/my-post.md` → `/blog/my-post`. Posts are listed newest first.

You can create a post in three ways:

1. **In the browser:** run `npm run dev`, open `/blog`, and click **+ New post**
   (or go to `/blog/new`). It has a Markdown preview and writes the `.md` file for you.
   The editor exists only on the dev server, not on the live site.
2. **From the terminal:** `npm run new-post -- "My post title"` (add `--draft` for a draft).
3. **By hand:** add a `.md` file in that folder with this format:

```markdown
---
title: "My post title"
date: 2026-11-09
summary: "Optional one-liner shown on the blog list."
cover: "/images/blog/optional-cover.png"
draft: true
---

Regular **Markdown** here.
```

Drafts (`draft: true`) appear while running `npm run dev` and are hidden from production builds.
Put post images in `public/images/blog/` and reference them as `/images/blog/<file>`.

To publish a post, commit its `.md` file (and any images), then rebuild and deploy.

## Case studies

The home page and `/work-posts/<slug>` pages are generated from `src/data/work.json`.
To add or edit a case study, edit that file. Images live in `public/images/work/`.

## Contact form

The home page contact form posts JSON (`Name`, `Email`, `Message`) to `VITE_CONTACT_ENDPOINT`
(for example a Formspree endpoint). Set it in a `.env` file:

```bash
VITE_CONTACT_ENDPOINT=https://formspree.io/f/your-id
```

## Project layout

- `src/styles/webflow.css`: the stylesheet exported from the Webflow site, unchanged
- `src/styles/site.css`: the cube animation, scroll reveal and blog styles
- `src/pages/`: one component per route
- `scripts/blog-files.ts`: creates post files (used by the dev editor and `npm run new-post`)

## Deploying

This is a single-page app, so the host must serve `index.html` for unknown paths
(e.g. Netlify `_redirects`: `/* /index.html 200`, or Vercel `rewrites`).
