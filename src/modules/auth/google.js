import { OAuth2Client } from 'google-auth-library'
import { env } from '../../config/env.js'
import { AppError } from '../../utils/AppError.js'

const client = new OAuth2Client()

// The app gets an ID token from Google and sends it here. We ask Google's
// library to check it: signed by Google, not expired, and made for one of OUR
// client ids (the "audience"). Then we read who it is.
export async function verifyGoogleIdToken(idToken) {
  if (env.GOOGLE_CLIENT_IDS.length === 0) {
    throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not set up yet')
  }

  let payload
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_IDS })
    payload = ticket.getPayload()
  } catch {
    throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Please try again.')
  }

  if (!payload?.sub || !payload.email) {
    throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Please try again.')
  }
  if (payload.email_verified !== true) {
    throw new AppError(401, 'GOOGLE_EMAIL_NOT_VERIFIED', 'Your Google email is not verified yet')
  }

  return {
    googleId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: payload.name?.trim().slice(0, 60) || null,
  }
}

// Decide what to do with a verified Google person. Pure function, so it's
// easy to test (see tests/google.test.js).
//   byGoogle: the user who already has this googleId, or null
//   byEmail:  the user who already has this email, or null
// Returns one of:
//   { action: 'login',  user }                        already linked
//   { action: 'link',   user, dropPassword }          email account, link Google to it
//   { action: 'create' }                              brand new person
export function decideGoogleAccount({ byGoogle, byEmail, googleId }) {
  if (byGoogle) return { action: 'login', user: byGoogle }

  if (byEmail) {
    // This email is already linked to a DIFFERENT Google account. Don't guess.
    if (byEmail.googleId && byEmail.googleId !== googleId) {
      throw new AppError(409, 'GOOGLE_ACCOUNT_MISMATCH', 'This email is linked to a different Google account')
    }

    // Google has proved this person owns the inbox. If the existing account
    // never verified its email, whoever set its password never proved they own
    // it, so that password can't be trusted: remove it and end its sessions.
    // (Stops someone signing up with your email first, then waiting for you.)
    return { action: 'link', user: byEmail, dropPassword: !byEmail.emailVerified }
  }

  return { action: 'create' }
}
