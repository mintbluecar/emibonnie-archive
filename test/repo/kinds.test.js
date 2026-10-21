// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { listItemKindCodes } from '../../src/repo/kinds.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

test('listItemKindCodes lists the item_kinds rows the engine migration inserts', async () => {
  assert.deepEqual(await listItemKindCodes(db), ['translation']);
});
