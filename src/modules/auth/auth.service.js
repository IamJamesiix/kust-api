import { prisma } from '../../lib/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { hashPassword, checkPassword, publicUser } from '../../utils/password.js'
import { issueTokens, revokeAllTokens, sha256 } from './tokens.js'
import { sendCode, useCode } from './otp.js'
import { verifyGoogleIdToken, decideGoogleAccount } from './google.js'

export async function register({ email, password, name, incomeType }) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) throw new AppError(409, 'EMAIL_TAKEN', 'An account with that email already exists')

  const user = await prisma.user.create({
    data: { email, name, incomeType, passwordHash: await hashPassword(password) },
  })

  // Send the verification code. If email fails, sign-up still works — they can tap "resend".
  const emailSent = await sendCode(user, 'VERIFY_EMAIL')

  return { user: publicUser(user), emailSent, ...(await issueTokens(user)) }
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } })
  // Google-only accounts have no password, so they can never match here.
  const ok = user?.passwordHash && (await checkPassword(password, user.passwordHash))
  // Same message for "no such email", "wrong password" and "Google-only account"
  // so attackers can't use login to find out which emails have accounts.
  if (!ok) {
    throw new AppError(401, 'BAD_CREDENTIALS', 'Email or password is wrong. If you signed up with Google, use Continue with Google.')
  }

  return { user: publicUser(user), ...(await issueTokens(user)) }
}

// Rotation: every refresh kills the old token and hands out a new pair.
export async function refresh({ refreshToken }) {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(refreshToken) },
    include: { user: true },
  })

  if (!stored) throw new AppError(401, 'REFRESH_INVALID', 'Refresh token invalid')

  // An already-used token showing up again = probably stolen. Log the user out everywhere.
  if (stored.revokedAt) {
    await revokeAllTokens(stored.userId)
    throw new AppError(401, 'REFRESH_REUSED', 'Session expired, log in again')
  }

  if (stored.expiresAt < new Date()) throw new AppError(401, 'REFRESH_EXPIRED', 'Session expired, log in again')

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } })
  return issueTokens(stored.user)
}

export async function logout({ refreshToken }) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function logoutAll(userId) {
  await revokeAllTokens(userId)
}

// ---------------------------------------------------------------- Google sign-in

// One endpoint for both sign up and log in. `verify` can be swapped in tests.
export async function googleLogin({ idToken }, { verify = verifyGoogleIdToken } = {}) {
  const google = await verify(idToken)

  const [byGoogle, byEmail] = await Promise.all([
    prisma.user.findUnique({ where: { googleId: google.googleId } }),
    prisma.user.findUnique({ where: { email: google.email } }),
  ])
  const decision = decideGoogleAccount({ byGoogle, byEmail, googleId: google.googleId })

  let user
  if (decision.action === 'login') {
    user = decision.user
  } else if (decision.action === 'link') {
    user = await prisma.user.update({
      where: { id: decision.user.id },
      data: {
        googleId: google.googleId,
        emailVerified: true,
        name: decision.user.name ?? google.name,
        ...(decision.dropPassword ? { passwordHash: null } : {}),
      },
    })
    if (decision.dropPassword) await revokeAllTokens(user.id)
  } else {
    user = await prisma.user.create({
      data: { email: google.email, name: google.name, googleId: google.googleId, emailVerified: true },
    })
  }

  return {
    user: publicUser(user),
    isNewUser: decision.action === 'create',
    ...(await issueTokens(user)),
  }
}

// ---------------------------------------------------------------- email verification

export async function resendVerification(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found')
  if (user.emailVerified) throw new AppError(400, 'ALREADY_VERIFIED', 'Your email is already verified')

  const emailSent = await sendCode(user, 'VERIFY_EMAIL')
  return { emailSent }
}

// Returns fresh tokens: the old access token still says "not verified".
export async function verifyEmail(userId, { code }) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found')
  if (user.emailVerified) throw new AppError(400, 'ALREADY_VERIFIED', 'Your email is already verified')

  await useCode(user.id, 'VERIFY_EMAIL', code)
  const verified = await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } })

  return { user: publicUser(verified), ...(await issueTokens(verified)) }
}

// ---------------------------------------------------------------- forgot / reset password

// Always answers the same way, whether the email exists or not, so this can't be
// used to find out who has an account.
export async function forgotPassword({ email }) {
  const user = await prisma.user.findUnique({ where: { email } })
  if (user) {
    try {
      await sendCode(user, 'RESET_PASSWORD')
    } catch (err) {
      if (err.code !== 'OTP_COOLDOWN') throw err // cooldown: stay quiet, a code was just sent
    }
  }
  return { message: 'If that email has an account, a reset code is on its way.' }
}

export async function resetPassword({ email, code, newPassword }) {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) throw new AppError(400, 'OTP_EXPIRED', 'That code has expired. Ask for a new one.')

  await useCode(user.id, 'RESET_PASSWORD', code)

  // They proved they own the inbox, so the email counts as verified too.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), emailVerified: true },
  })
  await revokeAllTokens(user.id) // every old session dies

  return { user: publicUser(updated), ...(await issueTokens(updated)) }
}
