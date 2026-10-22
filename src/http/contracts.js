// @ts-check
/**
 * The JSON shapes the public API returns (the pages in Plan 1b render
 * them). The server resolves everything shown -- names (through the
 * site's `formatName`), standard emoji, colours, continuation and which
 * media to show -- so the browser only renders. Text is raw: it is
 * escaped by the page, never here.
 *
 * Dates are `YYYY-MM-DD`; timestamps are ISO 8601 strings.
 *
 * @typedef {{ id: number, name: string, emoji: string, colour: string, igHandle: string|null }} PersonChip
 *
 * @typedef {{ kind: 'speech', emoji: string, name: string|null, colour?: string, text: string, cont: boolean }} SpeechBubble
 *   A line with a speaker marker. A known person shows their standard
 *   emoji, name and colour; a generic role keeps the translator's own
 *   marker as `emoji`, is named after the role, and has no `colour`; a
 *   marker the item never mapped keeps the marker, with `name: null` and
 *   no `colour` (both neutral). `cont`: the previous bubble had the same
 *   speaker, so the page shows no emoji or name.
 * @typedef {{ kind: 'joint', parts: { emoji: string, name: string|null }[], text: string, cont: boolean }} JointBubble
 *   A line whose marker is 2+ markers run together (e.g. both hosts
 *   reacting at once): every speaker shares one neutral bubble (no
 *   colour). `parts`, in line order: each component's display emoji and
 *   name, resolved exactly as a `SpeechBubble` would (a crowd component
 *   keeps its role name here instead of becoming a `kind: 'crowd'`
 *   bubble); a never-mapped component has `name: null`, same meaning as
 *   `SpeechBubble`'s. The page joins the names with " & ".
 * @typedef {SpeechBubble
 *   | JointBubble
 *   | { kind: 'crowd', text: string }
 *   | { kind: 'plain', text: string }
 *   | { kind: 'note', mark: '*'|'**', text: string }} BubbleVM
 *   `note`s (footnotes) always come after every other bubble.
 *
 * @typedef {{ sourceId: string, url: string }} ItemLink
 * @typedef {{ slug: string, name: string, occurredOn: string }} EventRef
 *
 * @typedef {{
 *   kind: string, sourceId: string, url: string, lines: BubbleVM[], people: PersonChip[],
 *   accountHandle: string|null, hasVideo: boolean, followsOnFrom: ItemLink|null,
 * }} KindPreview
 *   What a kind's `present.preview` returns: its opening lines (the first
 *   2 speech bubbles, or failing that the first 2 plain lines that aren't
 *   header). `hasVideo`: the item's media (MediaVM) is, or quotes, a clip
 *   that is still live. `followsOnFrom`: the visible item this one follows on from.
 * @typedef {KindPreview & { occurredOn: string, placement: import('../domain/constants.js').Placement }} Preview
 *   An item in a list: the kind's preview plus the shared fields every
 *   kind has (added by src/services/cards.js): the date it happened on
 *   and its placement.
 *
 * @typedef {{ url: string, width: number, height: number }} ImageVM
 * @typedef {{ bitrate: number, url: string }} VariantVM
 * @typedef {{ type: 'video', variants: VariantVM[], width: number, height: number }} VideoVM
 * @typedef {{ type: 'images', images: ImageVM[] }} ImagesVM
 * @typedef {{ type: 'quote', authorName: string|null, authorHandle: string|null, text: string, postedAt: string|null,
 *   inner: VideoVM|ImagesVM|null }} QuoteVM
 * @typedef {VideoVM|ImagesVM|QuoteVM} MediaVM
 *   What the pinned area shows: the translator's own clip, else their own
 *   pictures, else the quoted post (its pictures or clip as `inner`). A
 *   clip or pictures only while their source is live; the quote card
 *   always (its text is archived), its `inner` only while live.
 *
 * @typedef {{ kind: 'person', id: number, emoji: string, name: string, colour: string, igHandle: string|null }
 *   | { kind: 'role', role: string, emoji: string, name: string }} CastVM
 *   Who speaks, in order of first line. Crowd and unmapped markers are left out.
 * @typedef {{ role: string, url: string, status: 'live'|'deleted'|'unavailable' }} SourceLinkVM
 * @typedef {{
 *   bubbles: BubbleVM[], cast: CastVM[], original: string,
 *   credits: { account: { handle: string, displayName: string|null }|null, clipBy: string|null,
 *     postedAt: string|null, occurredOn: string },
 *   sources: SourceLinkVM[], media: MediaVM|null,
 * }} DetailVM
 *   `original` is the verbatim text (every part, joined by a blank line).
 *   `clipBy`: the clip/picture account, when it isn't the translator.
 *
 * @typedef {{ kind: 'handle', handle: string } | { kind: 'name', name: string } | { kind: 'fan' }} AddedByVM
 *   Who added an item: an X user's handle, else the display name they
 *   chose, else (a deleted user, an opted-out X account, no name) `fan`,
 *   which the page shows as copy `item.addedByFan` ("a fan"). Never an
 *   id or an email.
 * @typedef {DetailVM & {
 *   kind: string, sourceId: string, url: string, placement: Preview['placement'], event: EventRef|null, people: PersonChip[],
 *   tags: { keyword: string|null, hashtags: string[] }, category: string|null, addedBy: AddedByVM|null,
 *   followsOnFrom: ItemLink|null, prev: ItemLink|null, next: ItemLink|null,
 * }} ItemView
 *   `prev`/`next`: the visible neighbours in the item's event. `tags`: the
 *   item's keyword and hashtags as first written (ignored hashtags left
 *   out). `category`: its type's name. `addedBy`: null for the engine's
 *   own writes (seeds, imports run as `system`).
 *
 * @typedef {{ slug: string, name: string, occurredOn: string, hashtag: string|null, counts: Record<string, number> }} HomeEvent
 *   `counts`: visible items per kind (kinds with none are left out).
 * @typedef {{ months: { month: string, events: HomeEvent[] }[] }} HomeView
 *   Visible events, newest first; `month` is `YYYY-MM`.
 *
 * @typedef {{ kind: string, total: number, hasMore: boolean, items: Preview[] }} Section
 * @typedef {{ kind: string, total: number, hasMore: boolean, items: (Preview & { event: EventRef|null })[] }} DatedSection
 *   Sections come in registry order; kinds with no visible items are left
 *   out. Hub pages (event, person, translator) take `?limit=` (1 to 50,
 *   default 50) and `?offset=` (0 to 10000, default 0), applied to every
 *   section: `items` is that page of the kind's items, `total` every
 *   visible one (a count query), `hasMore` whether any follow the page.
 *   Out-of-range values are a 400.
 *
 * @typedef {{
 *   event: { slug: string, name: string, occurredOn: string, hashtags: string[], keywords: string[],
 *     type: string|null, client: string|null },
 *   accountCount: number, counts: Record<string, number>, people: PersonChip[], sections: Section[],
 * }} EventView
 *   Items in event order (oldest first), paged per section. `type`: the event's category
 *   name; `client`: its client/media name. `counts`: visible items per
 *   kind (a count query, so never capped by a section's page size; kinds
 *   with none are left out).
 *
 * @typedef {{
 *   person: PersonChip & { featured: boolean }, counts: { items: number, events: number, sharedStories: number },
 *   sections: DatedSection[], redirectTo?: string,
 * }} PersonView
 *   Items newest first, paged per section. A person who isn't featured
 *   and is on no visible item has no page (404). `redirectTo`: the person's
 *   current IG handle, when the one asked for isn't it (case included).
 *
 * @typedef {{
 *   account: { handle: string, displayName: string|null, profileUrl?: string }, counts: { items: number },
 *   sections: DatedSection[], redirectTo?: string,
 * }} AccountView
 *   Items newest first, paged per section; `counts.items` counts every
 *   visible item (a count query). `redirectTo`: the current
 *   handle, when the one asked for isn't it (an old handle, or other case).
 *   `profileUrl`: the matched kind's own `profileUrl(handle)`, when it
 *   defines one (a kind-specific link, e.g. an X profile -- left out
 *   entirely for a kind that doesn't).
 * @typedef {{ account: { handle: string, optedOut: true } }} OptedOutAccountView
 *   All an opted-out account's page gets: `handle` is the one asked for.
 *
 * @typedef {{
 *   people: PersonChip[], categories: { id: number, name: string }[], clients: { id: number, name: string }[],
 *   events: { slug: string, name: string }[], accounts: { handle: string }[],
 * }} FilterOptions
 *   `people`: featured people, and anyone else on a visible item.
 *   `categories`/`clients`: those of a visible item (review round 1, I3:
 *   `clients` added). `events`: the 200 most recent visible events.
 *   `accounts`: only accounts with a visible item (so never an opted-out one).
 *
 * @typedef {Preview & { event: EventRef|null, matchLines: string[] }} SearchResult
 *   `matchLines`: the lines containing `q` (at most 3; none without `q`), each
 *   shown as the item page shows it: a speaker's marker becomes the display
 *   emoji (a person's standard emoji), the rest of the text stays verbatim,
 *   except that a long line is cut to about 120 characters around the
 *   match, with "…" where it was cut.
 * @typedef {{ count: number, results: SearchResult[] }} SearchResponse
 *   `count`: every match, ignoring `limit`/`offset`; `limit: 0` gives the count only.
 */

export {};
