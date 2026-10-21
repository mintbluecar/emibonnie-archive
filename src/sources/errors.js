// @ts-check

/**
 * Thrown by `fetchTweet` when given something that can't be a tweet id.
 * Task 12 re-exports this from `src/http/errors.js`; this is the
 * temporary home until that module exists.
 */
export class BadRequest extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'BadRequest';
  }
}
