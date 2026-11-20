import { z } from 'zod';
import { BUILDING_TYPES, UNIT_TYPES } from '@/game/config';

const uuid = z.string().uuid();
const units = z.record(z.string(), z.number().int().min(0).max(100000));

export const registerBody = z.object({ email: z.string().max(200), password: z.string().max(200), nickname: z.string().max(40) });
export const loginBody = z.object({ email: z.string().max(200), password: z.string().max(200) });
export const createClanBody = z.object({
  clanName: z.string().max(60),
  daimyoName: z.string().max(60),
  portrait: z.string().max(40),
  bannerColor: z.string().max(40),
  bannerMon: z.string().max(40),
  provinceId: uuid,
});
export const upgradeBody = z.object({ provinceId: uuid, type: z.enum(BUILDING_TYPES) });
export const recruitBody = z.object({ provinceId: uuid, unitType: z.enum(UNIT_TYPES), count: z.number().int().min(1).max(100000) });
export const marchBody = z.object({ fromProvinceId: uuid, toProvinceId: uuid, units });
export const declareBattleBody = z.object({ fromProvinceId: uuid, targetProvinceId: uuid, units });
export const unlockSkillBody = z.object({ skillCode: z.string().max(60) });
export const declareWarBody = z.object({ clanId: uuid });
export const proposeBody = z.object({ clanId: uuid, type: z.literal('peace') });
export const respondBody = z.object({ proposalId: uuid, accept: z.boolean() });
export const espionageBody = z.object({ operation: z.literal('scout'), provinceId: uuid });
export const markReadBody = z.object({ ids: z.array(uuid).max(200).optional() });
export const chatBody = z.object({ body: z.string().max(2000) });
