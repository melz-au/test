import data from '../data/work.json'

export type Image = { src: string; alt: string }

export type WorkPost = {
  slug: string
  /** Large headline shown on the home page, e.g. "Reducing time on task". */
  headline: string
  /** Project name + year, e.g. "Scheduling (2023)". */
  title: string
  /** HTML summary shown on the home page. */
  summary: string
  cardImage: Image | null
  mobileImage: Image | null
  tags: string[]
  heroImage: Image | null
  heroCaption: string
  /** HTML */
  intro: string
  roles: string[]
  /** HTML, up to three columns under "My Role". */
  roleColumns: string[]
  midImage: Image | null
  /** HTML */
  outcomes: string
  outcomesImage: Image | null
}

export const workPosts = data as WorkPost[]

export const getWorkPost = (slug: string) => workPosts.find((p) => p.slug === slug)

/** Old (misspelled) slugs from the Webflow site → current slugs. Old links redirect to the new URL. */
export const renamedWorkSlugs: Record<string, string> = {
  'digital-diagnositcs': 'digital-diagnostics',
  'accenture-multimedia-advertisting-platform': 'accenture-multimedia-advertising-platform',
}
