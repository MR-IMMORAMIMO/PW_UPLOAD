'use strict';

/**
 * Desktop UI variant selector (PW-V4-F1C).
 *
 * Pure helper that decides which renderer the Personal workspace launches.
 * Kept deliberately separate from the workspace/domain variant so the two are
 * never conflated:
 *
 *   workspace/domain variant = personal | team | team-demo  (unchanged)
 *   presentation/UI variant  = legacy | v4                  (new selector)
 *
 * External control: `SCT_UI_VARIANT` environment variable.
 *
 *   - legacy -> 'legacy' (explicit compatibility override)
 *   - unset / v4 / unknown -> 'v4' (Personal default)
 *
 * The selector ONLY affects the Personal workspace. It must never route Team
 * or team-demo modes into V4.
 */

/**
 * Resolve the UI variant from a raw `SCT_UI_VARIANT` value.
 *
 * Personal defaults to V4. Legacy remains an explicit compatibility override;
 * the independent workspace gate continues to exclude Team and team-demo.
 */
function resolveUiVariant(raw) {
  return raw === 'legacy' ? 'legacy' : 'v4';
}

/**
 * True only when the given workspace variant is Personal AND the UI variant is
 * 'v4'. This enforces that V4 is Personal-only.
 */
function shouldLaunchV4(workspaceVariant, uiVariant) {
  return workspaceVariant === 'personal' && uiVariant === 'v4';
}

/**
 * Build the window URL for the current UI variant from the server origin.
 *
 *   - legacy: the server root origin
 *   - v4:     origin + '/v4/' (the temporary renderer mount)
 */
function windowUrlForUiVariant(origin, uiVariant) {
  return uiVariant === 'v4' ? `${origin}/v4/` : origin;
}

module.exports = {
  resolveUiVariant,
  shouldLaunchV4,
  windowUrlForUiVariant,
};
