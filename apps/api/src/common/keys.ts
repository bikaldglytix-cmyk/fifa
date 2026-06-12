import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { findRepoRoot } from '@fifa/db';

/**
 * RS256 keypair for JWT signing (PRD §16: JWT with RS256).
 * Auto-generated on first boot into <repo>/.keys (gitignored); override with
 * JWT_PRIVATE_KEY_PATH / JWT_PUBLIC_KEY_PATH in production (mounted secrets).
 */
export function loadOrCreateKeys(): { privateKey: string; publicKey: string } {
  const privPath = process.env.JWT_PRIVATE_KEY_PATH ?? join(findRepoRoot(), '.keys', 'jwt-private.pem');
  const pubPath = process.env.JWT_PUBLIC_KEY_PATH ?? join(findRepoRoot(), '.keys', 'jwt-public.pem');

  if (existsSync(privPath) && existsSync(pubPath)) {
    return { privateKey: readFileSync(privPath, 'utf8'), publicKey: readFileSync(pubPath, 'utf8') };
  }

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  mkdirSync(join(findRepoRoot(), '.keys'), { recursive: true });
  writeFileSync(privPath, privateKey, 'utf8');
  writeFileSync(pubPath, publicKey, 'utf8');
  return { privateKey, publicKey };
}
