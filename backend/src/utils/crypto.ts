import bcrypt from 'bcryptjs';

/** bcrypt 密码哈希 */
export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

/** bcrypt 密码校验 */
export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}
