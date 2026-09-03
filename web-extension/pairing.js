// @ts-check

/**
 * Reuse a locally saved pairing only when Zotero still accepts it.
 * @param {{
 *   getToken: () => Promise<string>,
 *   getSession: () => Promise<unknown>,
 *   clearToken: () => Promise<void>,
 * }} dependencies
 * @returns {Promise<{session: unknown, alreadyPaired: true} | null>}
 */
export async function reuseExistingPairing(dependencies) {
  const token = await dependencies.getToken();
  if (!token) return null;
  try {
    return {
      session: await dependencies.getSession(),
      alreadyPaired: true,
    };
  } catch (error) {
    if (error?.code !== "UNAUTHORIZED") throw error;
    await dependencies.clearToken();
    return null;
  }
}
