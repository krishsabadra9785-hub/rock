/**
 * Product branding. The app is shown to users as "Sabadra Minerals".
 *
 * Technical identifiers deliberately keep the original "rock" name because
 * changing them would break deployment or data (see docs/ARCHITECTURE.md →
 * "Branding vs. technical identifiers"): the GitHub repository and Pages path
 * /rock/, the Firebase project rock-e6719, the login email domain rock.local,
 * Firestore collections, and the order-number prefix ROCK-YYYY-######.
 */
export const APP_NAME = 'Sabadra Minerals';
export const APP_FILE_PREFIX = 'sabadra-minerals';
/** Business name stored in settings by earlier versions; treated as "not customised". */
export const LEGACY_DEFAULT_BUSINESS_NAME = 'ROCK';
