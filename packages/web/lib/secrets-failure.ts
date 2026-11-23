/** Shared by the send and Claude token APIs. The SDK's Claude bridge also
 * reports this code as the terminal error when its token request fails. */
export const SECRETS_UNAVAILABLE_CODE = "SECRETS_UNAVAILABLE"

export const TURN_SECRETS_UNAVAILABLE_MESSAGE =
  "Couldn't set up the secure key proxy for this sandbox. This is usually temporary — try again in a few minutes."
