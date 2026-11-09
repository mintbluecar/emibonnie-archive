// @ts-check
/**
 * Event editing, Task 11: the edit event page's merge and create modes in
 * the browser. `e2e/owner.spec.js` already checks the events list, edit
 * mode and the tweets page in every project; this adds the other two
 * modes, read-only, in every project, and one run of the writing flow:
 * tick two events → merge → keep one → merge and save, then from that
 * event's tweets tick one → ＋ new event → create and move 1 tweet.
 *
 * The flow writes to the add config's shared database, so it runs in one
 * project and only ever merges events it made itself: two throwaway
 * events, each made by splitting one entry off a seeded event through the
 * owner API. Whatever happens, `finally` moves every entry back to that
 * seeded event, so the other specs see its entries where the seed put
 * them. The throwaway events stay behind, empty (there is no delete).
 */
import { test, expect } from '@playwright/test';
import { checkPage, signInAs, gotoReady } from './helpers.js';

/** Invented names, dated far ahead so they top the newest-first list. */
const KEEP = { name: 'Quillfeather night', occurredOn: '2099-06-02' };
const MERGED = { name: 'Brambleway fair', occurredOn: '2099-06-01' };
const CREATED = 'Lanternmoss market';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {{ id: number, name: string, entryCount: number }} EventRow */

/**
 * The owner API from inside the signed-in page: a GET, or a POST of `body`.
 * @param {Page} page @param {string} path @param {unknown} [body]
 * @returns {Promise<{ status: number, json: any }>}
 */
function ownerApi(page, path, body) {
  return page.evaluate(async ({ path: url, body: payload }) => {
    const init = payload === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    };
    const res = await fetch(url, init);
    return { status: res.status, json: await res.json().catch(() => null) };
  }, { path, body });
}

/** @param {Page} page @param {string} [q] @returns {Promise<EventRow[]>} */
async function listEvents(page, q = '') {
  const res = await ownerApi(page, `/api/owner/events${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  expect(res.status).toBe(200);
  return res.json.events;
}

/** @param {Page} page @param {number} id @returns {Promise<number[]>} the event's entries' item ids */
async function entryIdsOf(page, id) {
  const res = await ownerApi(page, `/api/owner/events/${id}/entries`);
  expect(res.status).toBe(200);
  return res.json.entries.map((/** @type {{ itemId: number }} */ e) => e.itemId);
}

/**
 * `entryIdsOf`, or `[]` for an event merged away (its entries are in the
 * event it went into, which answers them).
 * @param {Page} page @param {number} id @returns {Promise<number[]>}
 */
async function liveEntryIdsOf(page, id) {
  const res = await ownerApi(page, `/api/owner/events/${id}/entries`);
  if (res.status === 404) return [];
  expect(res.status).toBe(200);
  return res.json.entries.map((/** @type {{ itemId: number }} */ e) => e.itemId);
}

/** The first listed event with at least `min` entries. @param {Page} page @param {number} min @returns {Promise<EventRow>} */
async function eventWithEntries(page, min) {
  const event = (await listEvents(page)).find((e) => e.entryCount >= min);
  expect(event, `an event with ${min}+ entries`).toBeTruthy();
  return /** @type {EventRow} */ (event);
}

/** The "N events match" count on the events list. @param {Page} page @returns {Promise<number>} */
async function listedTotal(page) {
  const text = await page.getByText(/\d+ events? match/).textContent();
  return Number(/(\d+) events? match/.exec(String(text))?.[1]);
}

test('merge mode: the strip, a keep choice per event, and an accessible page', async ({ page }) => {
  await signInAs(page, 'owner');
  await gotoReady(page, '/me');
  const [a, b] = await listEvents(page);
  await checkPage(page, `/admin/events/edit?merge=${a.id},${b.id}`);
  await expect(page.locator('[data-event-keep]')).toHaveCount(2);
  await expect(page.locator('[data-event-move-notice]')).toBeVisible();
  await expect(page.locator('[data-event-edit-form] [type="submit"]')).toHaveText('Merge and save');
});

test('create mode: new event for the ticked tweet, and an accessible page', async ({ page }) => {
  await signInAs(page, 'owner');
  await gotoReady(page, '/me');
  const from = await eventWithEntries(page, 1);
  const [itemId] = await entryIdsOf(page, from.id);
  await checkPage(page, `/admin/events/edit?from=${from.id}&items=${itemId}`);
  await expect(page.getByRole('heading', { name: 'new event for 1 tweet' })).toBeVisible();
  await expect(page.locator('[data-event-name]')).toHaveValue('');
  await expect(page.locator('[data-event-edit-form] [type="submit"]')).toHaveText('Create and move 1 tweet');
});

test('merge two events, then move one tweet into a new event', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'writes to the shared e2e data; one project runs it (desktop, for the screenshots)');

  await signInAs(page, 'owner');
  await gotoReady(page, '/me');

  // Two throwaway events with one entry each, split off a seeded event.
  const source = await eventWithEntries(page, 2);
  const [firstItem, secondItem] = await entryIdsOf(page, source.id);
  const split = async (/** @type {number} */ itemId, /** @type {{ name: string, occurredOn: string }} */ event) => {
    const fields = { ...event, keywords: [], hashtags: [], livePeopleIds: [], livePlatformCode: null, addressTag: '' };
    const res = await ownerApi(page, `/api/owner/events/${source.id}/split`, { itemIds: [itemId], fields });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return /** @type {number} */ (res.json.eventId);
  };
  const keepId = await split(firstItem, KEEP);
  const mergedId = await split(secondItem, MERGED);

  try {
    // ① tick both → merge.
    await gotoReady(page, '/admin/events');
    const before = await listedTotal(page);
    await page.getByLabel(`tick ${KEEP.name}`).check();
    await page.getByLabel(`tick ${MERGED.name}`).check();
    await page.locator('[data-admin-events-merge]').click();
    await page.waitForURL(/\/admin\/events\/edit\?merge=/);

    // ② merge mode: keep one, and the title follows it.
    await page.locator(`[data-event-keep][value="${keepId}"]`).check();
    await expect(page.locator('[data-event-name]')).toHaveValue(KEEP.name);
    await expect(page.locator('[data-event-move-notice]')).toContainText('1 tweet from 1 event moves into this one');
    await page.screenshot({ path: testInfo.outputPath('merge-mode.png'), fullPage: true });
    await page.getByRole('button', { name: 'merge and save' }).click();
    await page.waitForURL(`**/admin/events/edit?id=${keepId}`);
    await expect(page.locator('[data-event-name]')).toHaveValue(KEEP.name);

    // The list has one fewer event, and the kept one holds both tweets.
    await gotoReady(page, '/admin/events');
    expect(await listedTotal(page)).toBe(before - 1);
    await expect(page.getByLabel(`tick ${MERGED.name}`)).toHaveCount(0);
    const keptRow = page.locator(`tr[data-event="${keepId}"]`);
    await expect(keptRow.locator('.table__num')).toHaveText('2');

    // ③ its tweets: tick one → ＋ new event.
    await keptRow.getByRole('link', { name: 'tweets' }).click();
    await page.waitForURL(`**/admin/events/entries?id=${keepId}`);
    await page.locator('[data-action="tick"]').first().check();
    await page.locator('[data-event-entries-new]').click();
    await page.waitForURL(new RegExp(`/admin/events/edit\\?from=${keepId}&items=\\d+$`));

    // ② create mode: name it, create and move.
    await expect(page.getByRole('heading', { name: 'new event for 1 tweet' })).toBeVisible();
    await page.locator('[data-event-name]').fill(CREATED);
    await page.screenshot({ path: testInfo.outputPath('create-mode.png'), fullPage: true });
    await page.getByRole('button', { name: 'create and move 1 tweet' }).click();
    await page.waitForURL(/\/admin\/events\/edit\?id=\d+$/);
    const createdId = Number(new URL(page.url()).searchParams.get('id'));
    expect(createdId).not.toBe(keepId);

    // The new event lists 1 entry, and the kept one is down to 1.
    await gotoReady(page, '/admin/events');
    const createdRow = page.locator(`tr[data-event="${createdId}"]`);
    await expect(createdRow).toContainText(CREATED);
    await expect(createdRow.locator('.table__num')).toHaveText('1');
    await expect(keptRow.locator('.table__num')).toHaveText('1');
  } finally {
    // Every entry back where the seed put it, whatever failed above. Once
    // the merge has run, the merged-away event answers 404 and its entries
    // are in the kept event, so only the events still live are emptied.
    const created = (await listEvents(page, CREATED)).map((e) => e.id);
    for (const id of [keepId, mergedId, ...created]) {
      const itemIds = await liveEntryIdsOf(page, id);
      if (itemIds.length === 0) continue;
      const res = await ownerApi(page, `/api/owner/events/${id}/move`, { itemIds, toEventId: source.id });
      expect(res.status, JSON.stringify(res.json)).toBe(200);
    }
    expect((await entryIdsOf(page, source.id)).length).toBe(source.entryCount);
  }
});
