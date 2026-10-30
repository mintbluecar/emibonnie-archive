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
 * Flags a rule whose selector targets a button- or field-like control
 * and that declares all three of a background
 * (`background`/`background-color`/`background-image`), a
 * `border-radius`, and a `padding*` -- the three together are what a
 * hand-rebuilt button/field control looks like (`btn`/`field`,
 * `src/styles/primitives/`). A control is button- or field-like when its
 * selector is:
 *   - `button`, `select` or `textarea`;
 *   - `input` with no type, or any type other than `checkbox`/`radio`
 *     (including base.css's own
 *     `input:not([type="checkbox"]):not([type="radio"])` form) --
 *     `input[type="checkbox"]`/`input[type="radio"]` are excluded: the
 *     `check` primitive, not `btn`/`field`, is their look; or
 *   - a class ending `__btn`/`__button`/`__submit`/`__save`/`__next`/
 *     `__apply`/`__more` (button-shaped) or `__field`/`__input`/
 *     `__control`/`__search`/`__textarea`/`__select` (field-shaped).
 */
import stylelint from 'stylelint';

const { createPlugin, utils } = stylelint;
const { report, ruleMessages, validateOptions } = utils;

const ruleName = 'local/no-rebuilt-primitive';

const messages = ruleMessages(ruleName, {
  rejected: (selector) =>
    `"${selector}" redeclares a primitive's look (background + border-radius + padding) -- use the btn/field primitive instead of rebuilding it`,
});

const CHECKBOX_OR_RADIO_INPUT = /input\s*\[\s*type\s*=\s*["']?(checkbox|radio)["']?\s*]/i;
const CONTROL_ELEMENT = /(^|[\s>+~,])\s*(button|select|textarea)(?=$|[\s>+~.:#[])/i;
const BUTTON_INPUT_TYPE = /input\s*\[\s*type\s*=\s*["']?(button|submit)["']?\s*]/i;
const INPUT_ELEMENT = /(^|[\s>+~,])\s*input(?=$|[\s>+~.:#[])/i;
const CONTROL_CLASS_SUFFIX = /__(btn|button|submit|save|next|apply|more|field|input|control|search|textarea|select)(?=$|[\s.:#[>+~])/;

/**
 * A selector names a button- or field-like control (never a checkbox or
 * radio, which keep the `check` primitive's look instead).
 * @param {string} selector @returns {boolean}
 */
function isControlLike(selector) {
  if (CHECKBOX_OR_RADIO_INPUT.test(selector)) return false;
  return (
    CONTROL_ELEMENT.test(selector) ||
    BUTTON_INPUT_TYPE.test(selector) ||
    INPUT_ELEMENT.test(selector) ||
    CONTROL_CLASS_SUFFIX.test(selector)
  );
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
    if (!splitSelectorList(ruleNode.selector).some(isControlLike)) return;

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
