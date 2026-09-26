/**
 * Étape 19 : catalogue des permissions et rôles système, recopiés depuis le domaine à chaque passage (source unique) ;
 * les rôles personnalisés des organisations ne sont jamais touchés.
 */
import { PERMISSION_CODES, PERMISSIONS, SYSTEM_ROLES } from '@neomoov/domain';
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { Database } from '../index.js';
import * as s from '../schema/index.js';

export async function seedAccess(db: Database): Promise<void> {
  for (const code of PERMISSION_CODES) {
    const d = PERMISSIONS[code];
    await db.insert(s.permissions).values({ code, module: d.module, description: d.description, sensitive: d.sensitive, platformOnly: d.platformOnly })
      .onConflictDoUpdate({ target: s.permissions.code, set: { module: d.module, description: d.description, sensitive: d.sensitive, platformOnly: d.platformOnly } });
  }
  for (const role of SYSTEM_ROLES) {
    const [existing] = await db.select({ id: s.roles.id }).from(s.roles).where(and(isNull(s.roles.organizationId), eq(s.roles.code, role.code))).limit(1);
    const id = existing?.id ?? (await db.insert(s.roles).values({ code: role.code, name: role.name, level: role.level }).returning({ id: s.roles.id }))[0]!.id;
    if (existing) await db.update(s.roles).set({ name: role.name, level: role.level }).where(eq(s.roles.id, id));
    await db.delete(s.rolePermissions).where(and(eq(s.rolePermissions.roleId, id), notInArray(s.rolePermissions.permissionCode, [...role.permissions])));
    await db.insert(s.rolePermissions).values(role.permissions.map((permissionCode) => ({ roleId: id, permissionCode }))).onConflictDoNothing();
  }
  // Permissions retirées du catalogue : plus aucun rôle ne les porte (les rôles personnalisés compris).
  const stale = await db.select({ code: s.permissions.code }).from(s.permissions).where(notInArray(s.permissions.code, [...PERMISSION_CODES]));
  if (stale.length) {
    const codes = stale.map((r: { code: string }) => r.code);
    await db.delete(s.rolePermissions).where(inArray(s.rolePermissions.permissionCode, codes));
    await db.delete(s.permissions).where(inArray(s.permissions.code, codes));
  }
}
