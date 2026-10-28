// @ts-check
/**
 * The request-level errors every layer may throw, mapped to HTTP statuses
 * by src/http/handler.js. Pure: no imports, so domain, sources, services
 * and http can all share one class per error (src/sources/errors.js and
 * src/http/errors.js re-export these).
 */

/** Input that can never be valid (400). The message names the field; it may echo the caller's own input. */
export class BadRequest extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'BadRequest';
  }
}

/** Nothing public at this address (404). Carries no detail, so a hidden item and a missing one look the same. */
export class NotFound extends Error {
  constructor() {
    super('not found');
    this.name = 'NotFound';
  }
}

/** The request conflicts with the resource's state (409); `code` is the public error code. */
export class Conflict extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'Conflict';
    this.code = code;
  }
}

/** Too many requests (429). Database-backed limits arrive in Plan 2. */
export class RateLimited extends Error {
  constructor() {
    super('rate limited');
    this.name = 'RateLimited';
  }
}

/** Signed out (401). Carries no detail: the public error code is fixed. */
export class Unauthorized extends Error {
  constructor() {
    super('signed out');
    this.name = 'Unauthorized';
  }
}

/** Signed in but not allowed (403); `code` is the public error code. */
export class Forbidden extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'Forbidden';
    this.code = code;
  }
}

/** A request body over the size limit (413). */
export class PayloadTooLarge extends Error {
  constructor() {
    super('payload too large');
    this.name = 'PayloadTooLarge';
  }
}
