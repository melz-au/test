# Flytype

React (Vite + TypeScript) rebuild of [flytype.webflow.io](https://flytype.webflow.io), with a Markdown blog.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # static site in dist/
```

## Writing blog posts

### On the live site (recommended)

Go to **`/admin`** on the live site and sign in with the admin password. From there you can write,
preview, edit and delete posts and upload images. Publishing commits the post to GitHub
(`src/content/blog/<slug>.md`, images in `public/images/blog/`), which triggers a Cloudflare rebuild,
so the post is live about 2 minutes later.

### Other ways

Every Markdown file in `src/content/blog/` is a blog post, and its file name is the URL
(`my-post.md` → `/blog/my-post`). You can also:

- run `npm run dev` and use **+ New post** at `/blog/new` (writes the file locally; commit it to publish),
- run `npm run new-post -- "My post title"` (add `--draft` for a draft), or
- add or edit a file on GitHub directly.

File format:

```markdown
---
title: "My post title"
date: 2026-11-10
summary: "Optional one-liner shown on the blog list."
cover: "/images/blog/optional-cover.png"
draft: true
---

Regular **Markdown** here.
```

Drafts (`draft: true`) are hidden from the live site; they show in `/admin` and with `npm run dev`.

## Case studies

Edit case studies on the live site at **`/admin` → Case studies**: change text and images, add new
ones, hide them, reorder them (the order is the home page order) or delete them. Saving commits
`src/data/work.json` (and uploaded images in `public/images/work/`) to GitHub, and the site rebuilds.

Text fields (summary, introduction, role columns, outcomes) are Markdown. Hidden case studies
(`"draft": true`) don't appear on the live site, but do with `npm run dev`. You can also edit
`src/data/work.json` directly.

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

## Deploying (Cloudflare Workers)

`wrangler.jsonc` configures the Worker: it serves `dist/`, falls back to `index.html` for page URLs,
and runs `worker/index.ts` for `/api/*` (the blog admin API).

- The `name` in `wrangler.jsonc` must match the Worker's name in the Cloudflare dashboard.
- Workers Builds should use build command `npm run build` and deploy command `npx wrangler deploy`,
  with `master` as the production branch.
- Set these **secrets** on the Worker (dashboard → your Worker → Settings → Variables and Secrets,
  type *Secret*, or `npx wrangler secret put NAME`):
  - `ADMIN_PASSWORD`: the password for `/admin`. Use a long one.
  - `GITHUB_TOKEN`: a fine-grained GitHub token limited to this repository with
    **Contents: Read and write** permission. Create it on GitHub under Settings → Developer settings →
    Personal access tokens → Fine-grained tokens → Generate new token: choose *Only select repositories*
    → `melz-au/test`, and under Repository permissions set *Contents* to *Read and write*. When the token
    expires, publishing from `/admin` stops until you replace the secret with a new token.
- `GITHUB_REPO` and `GITHUB_BRANCH` are set in `wrangler.jsonc`.
- Admin API requests are limited to 60 per minute per IP address.

To try the admin page locally, copy `.dev.vars.example` to `.dev.vars`, fill it in, and run
`npm run preview:worker`. That uses the real GitHub repo, so posts you publish there are real.
