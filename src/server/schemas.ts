import { z } from 'zod';
import { CLAN_PERMISSIONS, CLAN_ROLES, DOCTRINES, RECRUITMENT_MODES, WAR_DUTIES } from '@/game/clan';
import { BUILDING_TYPES, UNIT_TYPES } from '@/game/config';
import { PILLARS } from '@/game/pillars';
import { STANCES, TACTICS } from '@/game/strategy';

const uuid = z.string().uuid();
const units = z.record(z.string(), z.number().int().min(0).max(100000));

export const registerBody = z.object({ email: z.string().max(200), password: z.string().max(200), nickname: z.string().max(40) });
export const loginBody = z.object({ email: z.string().max(200), password: z.string().max(200) });
const bag = z.object({
  gold: z.number().int().min(0).max(100_000_000).optional(),
  food: z.number().int().min(0).max(100_000_000).optional(),
  wood: z.number().int().min(0).max(100_000_000).optional(),
  stone: z.number().int().min(0).max(100_000_000).optional(),
  iron: z.number().int().min(0).max(100_000_000).optional(),
});
export const createClanBody = z.object({
  clanName: z.string().max(60),
  tag: z.string().max(10),
  description: z.string().max(1000).optional(),
  recruitment: z.enum(RECRUITMENT_MODES).optional(),
  language: z.string().max(10).optional(),
  daimyoName: z.string().max(60),
  portrait: z.string().max(40),
  bannerColor: z.string().max(40),
  bannerMon: z.string().max(40),
  provinceId: uuid,
});
export const upgradeBody = z.object({ provinceId: uuid, type: z.enum(BUILDING_TYPES) });
export const recruitBody = z.object({ provinceId: uuid, unitType: z.enum(UNIT_TYPES), count: z.number().int().min(1).max(100000) });
export const marchBody = z.object({ fromProvinceId: uuid, toProvinceId: uuid, units, tactic: z.enum(TACTICS).optional() });
export const declareBattleBody = z.object({ fromProvinceId: uuid, targetProvinceId: uuid, units, tactic: z.enum(TACTICS).optional() });
export const unlockSkillBody = z.object({ skillCode: z.string().max(60) });
export const declareWarBody = z.object({ clanId: uuid });
export const proposeBody = z.object({ clanId: uuid, type: z.enum(['peace', 'nap', 'alliance']) });
export const breakPactBody = z.object({ pactId: uuid });
export const stanceBody = z.object({ stance: z.enum(STANCES) });
export const doctrineBody = z.object({ doctrine: z.enum(DOCTRINES) });
export const warPlanBody = z.object({
  title: z.string().max(200),
  targetProvinceId: uuid,
  originProvinceId: uuid,
  tactic: z.enum(TACTICS),
  units,
  commanderId: uuid.nullable(),
  scheduledAt: z.string().max(40).nullable().optional(),
  notes: z.string().max(2000).optional(),
});
export const warPlanStatusBody = z.object({ status: z.enum(['draft', 'ready', 'cancelled']) });
export const warAssignBody = z.object({ playerId: uuid, duty: z.enum(WAR_DUTIES), note: z.string().max(400).optional() });
export const warRespondBody = z.object({ duty: z.enum(WAR_DUTIES), accept: z.boolean() });
export const respondBody = z.object({ proposalId: uuid, accept: z.boolean() });
export const espionageBody = z.object({ operation: z.literal('scout'), provinceId: uuid });
export const markReadBody = z.object({ ids: z.array(uuid).max(200).optional() });
export const chatBody = z.object({ channel: z.enum(['world', 'clan', 'dm']).optional(), to: uuid.optional(), body: z.string().max(2000) });
export const chatReadBody = z.object({ thread: z.string().max(40) });
export const applyBody = z.object({ message: z.string().max(1000).optional() });
export const applicationBody = z.object({ applicationId: uuid, accept: z.boolean() });
export const withdrawApplicationBody = z.object({ applicationId: uuid });
export const inviteBody = z.object({ nickname: z.string().min(1).max(40) });
export const invitationBody = z.object({ invitationId: uuid });
export const invitationAnswerBody = z.object({ invitationId: uuid, accept: z.boolean() });
export const setRoleBody = z.object({ playerId: uuid, role: z.enum(CLAN_ROLES) });
export const memberBody = z.object({ playerId: uuid });
export const clanSettingsBody = z.object({
  description: z.string().max(1000).optional(),
  recruitment: z.enum(RECRUITMENT_MODES).optional(),
  language: z.string().max(10).optional(),
});
export const permissionsBody = z.object({ role: z.enum(CLAN_ROLES), permissions: z.array(z.enum(CLAN_PERMISSIONS)).max(20) });
export const announcementBody = z.object({ body: z.string().max(2000) });
export const contributeBody = z.object({ resources: bag });
export const withdrawBody = z.object({ playerId: uuid, resources: bag, note: z.string().max(300).optional() });
export const profileBody = z.object({ portrait: z.string().max(40).optional(), trainingFocus: z.enum(PILLARS).optional() });
