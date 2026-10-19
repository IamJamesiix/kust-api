import bcrypt from 'bcryptjs'

export const hashPassword = (plain) => bcrypt.hash(plain, 12)
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash)

// Never send passwordHash to the app
export const publicUser = ({ passwordHash, ...user }) => user
