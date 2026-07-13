type MigrationDatabase = {
  prepare(sql: string): {
    all(...parameters: unknown[]): unknown[];
    run(...parameters: unknown[]): { changes: number };
  };
};

/**
 * Assigns pre-user-scoping TV-app records only when there is one unambiguous
 * local owner. Global discovery records (Cast/DLNA) remain unowned.
 */
export function migrateLegacyTrustedDeviceOwners(database: MigrationDatabase) {
  const users = database.prepare("SELECT id,role FROM users ORDER BY id").all() as Array<{ id: number; role: string }>;
  const admins = users.filter(user => user.role === 'admin');
  const owner = admins.length === 1 ? admins[0] : users.length === 1 ? users[0] : null;
  if (!owner) return { ownerId: null, assigned: 0 };
  const assigned = database.prepare(`UPDATE playback_devices SET user_id=?
    WHERE trusted=1 AND user_id IS NULL AND requires_pairing=1`).run(owner.id).changes;
  return { ownerId: owner.id, assigned };
}
