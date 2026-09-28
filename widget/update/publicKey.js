/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/**
 * The public half of the key that signs each release's latest.json. The
 * private half exists only in the release machine's login keychain (service
 * "hud-for-claude-update-key"), and scripts/release-manifest.mjs refuses to
 * publish a signature this key does not accept.
 *
 * Changing it strands every copy already installed: they will reject the new
 * signatures, so each must be updated by hand once.
 */
module.exports = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAZVTP5/g/pYtTHIgDjVwre2asIoVtrW9rQSRSr76SecM=
-----END PUBLIC KEY-----
`;
