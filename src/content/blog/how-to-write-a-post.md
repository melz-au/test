---
title: "How to write a blog post"
date: 2026-11-09
summary: "An example draft showing the Markdown format. Drafts only appear while running the dev server."
draft: true
---

Every file in `src/content/blog/` is a blog post. The file name becomes the URL, so this file is served at `/blog/how-to-write-a-post`.

## Front matter

The block between the `---` lines at the top sets:

- `title`: the post title
- `date`: `YYYY-MM-DD`, newest posts are listed first
- `summary`: optional, shown on the blog list
- `cover`: optional image path, e.g. `/images/blog/my-image.png`
- `draft`: `true` hides the post from the live site

## Body

Everything after the front matter is regular **Markdown**: headings, lists, [links](/about), images and

> quotes like this one.

Delete this file once you've written your first real post.
