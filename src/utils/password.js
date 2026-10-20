import bcrypt from 'bcryptjs'

export const hashPassword = (plain) => bcrypt.hash(plain, 12)
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash)

// Never send passwordHash (or the raw Google id) to the app. The app gets
// two flags instead, so it can show "add a password" / "linked to Google".
export const publicUser = ({ passwordHash, googleId, ...user }) => ({
  ...user,
  hasPassword: Boolean(passwordHash),
  hasGoogle: Boolean(googleId),
})
