// @ts-check
/**
 * Styling system Task 5, spec "6. Enforcement": "in components/ ...
 * forbid redeclaring button/field looks (background + border-radius +
 * padding on a button selector)". Not expressible with a stylelint
 * built-in list-rule (it's a multi-property co-occurrence check across
 * one rule's declarations), so a small local plugin.
 *
 * Registered in `.stylelintrc.json` as `local/no-rebuilt-primitive`,
 * applied only to `src/styles/components/*.css` -- primitives
 * themselves (`src/styles/primitives/button.css`, `field.css`) legitimately
 * declare all three; that's their job.
 *
 * Flags a rule whose selector targets a button-like element (`button`,
 * `input[type=button]`, `input[type=submit]`, `select`, `textarea`, or a
 * class ending in `__btn`/`__button`/`__submit`/`__save`/`__next`/`__apply`/
 * `__more`) and that declares all three of a background
 * (`background`/`background-color`/`background-image`), a
 * `border-radius`, and a `padding*` -- the three together are what a
 * hand-rebuilt button/field control looks like (`btn`/`field`,
 * `src/styles/primitives/`).
 */
import stylelint from 'stylelint';

const { createPlugin, utils } = stylelint;
const { report, ruleMessages, validateOptions } = utils;

const ruleName = 'local/no-rebuilt-primitive';

const messages = ruleMessages(ruleName, {
  rejected: (selector) =>
    `"${selector}" redeclares a primitive's look (background + border-radius + padding) -- use the btn/field primitive instead of rebuilding it`,
});

const BUTTON_ELEMENT = /(^|[\s>+~,])\s*(button|select|textarea)(?=$|[\s>+~.:#[])/i;
const BUTTON_INPUT = /input\s*\[\s*type\s*=\s*["']?(button|submit)["']?\s*]/i;
const BUTTON_CLASS_SUFFIX = /__(btn|button|submit|save|next|apply|more)(?=$|[\s.:#[>+~])/;

/** @param {string} selector @returns {boolean} */
function isButtonLike(selector) {
  return BUTTON_ELEMENT.test(selector) || BUTTON_INPUT.test(selector) || BUTTON_CLASS_SUFFIX.test(selector);
}

/**
 * Splits a selector list on top-level commas only -- never inside `[...]`
 * or `(...)` (an attribute selector's value, or `:not(a, b)`).
 * @param {string} selectors @returns {string[]}
 */
function splitSelectorList(selectors) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of selectors) {
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** @type {import('stylelint').Rule} */
const rule = (primary) => (root, result) => {
  const validOptions = validateOptions(result, ruleName, { actual: primary, possible: [true] });
  if (!validOptions) return;

  root.walkRules((ruleNode) => {
    if (!splitSelectorList(ruleNode.selector).some(isButtonLike)) return;

    let hasBackground = false;
    let hasRadius = false;
    let hasPadding = false;
    ruleNode.walkDecls((decl) => {
      if (/^background(-color|-image)?$/.test(decl.prop)) hasBackground = true;
      if (decl.prop === 'border-radius') hasRadius = true;
      if (/^padding/.test(decl.prop)) hasPadding = true;
    });

    if (hasBackground && hasRadius && hasPadding) {
      report({
        message: messages.rejected,
        messageArgs: [ruleNode.selector],
        node: ruleNode,
        result,
        ruleName,
      });
    }
  });
};

rule.ruleName = ruleName;
rule.messages = messages;

export default createPlugin(ruleName, rule);
