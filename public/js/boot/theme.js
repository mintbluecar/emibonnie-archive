// @ts-check
/**
 * The blocking `<head>` script every page loads before its stylesheet
 * paints (Task 10c, f): applies the remembered theme choice as
 * `data-theme` on `<html>`, so a forced light or dark page never flashes
 * the device's theme first. External (the CSP allows no inline script).
 */
import { showChoice, storedChoice } from '../core/themeChoice.js';

showChoice(storedChoice());
