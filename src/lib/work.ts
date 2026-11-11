import data from '../data/work.json'
import type { WorkPost } from './work-format'

export type { Image, WorkPost } from './work-format'

const all = data as WorkPost[]

/** Hidden case studies (draft: true) show while running `npm run dev`, not on the live site. */
export const workPosts = import.meta.env.DEV ? all : all.filter((p) => !p.draft)

export const getWorkPost = (slug: string) => workPosts.find((p) => p.slug === slug)

/** Old (misspelled) slugs from the Webflow site → current slugs. Old links redirect to the new URL. */
export const renamedWorkSlugs: Record<string, string> = {
  'digital-diagnositcs': 'digital-diagnostics',
  'accenture-multimedia-advertisting-platform': 'accenture-multimedia-advertising-platform',
}
