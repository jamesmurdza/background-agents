/**
 * Agent deep-link route (e.g. /agent/factory, /agent/kimi)
 *
 * This is a thin wrapper that renders the main app page.
 * The app/page.tsx handles URL routing internally: useUrlSync reads the
 * slug from the path, resolves it to an agent, and preselects it on a new
 * draft chat before normalizing the URL to "/".
 */

import HomePage from "../../page"

export default HomePage
