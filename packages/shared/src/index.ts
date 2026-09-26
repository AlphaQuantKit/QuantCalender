import { z } from 'zod'

// Platform country/region codes, without a geographic allowlist.
export const countrySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, '地区须为两位字母代码')
export const eventStatusSchema = z.enum(['draft', 'pending', 'published', 'rejected', 'cancelled'])
export const recurrenceKindSchema = z.enum(['none', 'weekly', 'biweekly', 'monthly'])

export const recurrenceSchema = z.object({
  kind: recurrenceKindSchema.default('none'),
  untilLocal: z.string().datetime({ local: true }).nullable().default(null)
}).superRefine((value, context) => {
  if (value.kind !== 'none' && !value.untilLocal) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['untilLocal'], message: '重复会议必须设置结束时间' })
  }
})

const safeHttpsUrl = z.string().url().max(2048).refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}, '仅支持不包含账号密码的 HTTPS 链接')

export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD').refine((value) => {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}, '日期无效')

export const meetingInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  category: z.string().trim().min(1).max(48),
  meetingLanguage: z.enum(['zh', 'en', 'bilingual', 'other']).default('zh'),
  registrationUrl: safeHttpsUrl,
  startLocal: z.string().datetime({ local: true }),
  durationMinutes: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120), z.literal(180)]).default(60),
  recurrence: recurrenceSchema.default({ kind: 'none', untilLocal: null })
}).superRefine((value, context) => {
  if (value.recurrence.untilLocal && value.recurrence.untilLocal <= value.startLocal) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['recurrence', 'untilLocal'], message: '重复结束时间必须晚于首次会议' })
  }
})

export const memberLoginSchema = z.object({
  wqId: z.string().trim().min(2).max(64),
  password: z.string().min(1).max(128),
  turnstileToken: z.string().max(4096).default('')
})

export const adminLoginSchema = memberLoginSchema.extend({
  password: z.string().min(12).max(256)
})

export const newMemberPasswordSchema = z.string().min(12, '新密码至少 12 位').max(128, '新密码最多 128 位')
  .refine(value => value.trim().length > 0, '密码不能全为空白')
export const memberPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: newMemberPasswordSchema
}).strict()
export const adminMemberPasswordSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), newPassword: newMemberPasswordSchema }).strict(),
  z.object({ action: z.literal('reset') }).strict()
])

export const memberImportRowSchema = z.object({
  wqId: z.string().trim().min(2).max(64),
  country: countrySchema
})

export const importRowsSchema = z.object({
  rows: z.array(memberImportRowSchema).min(1).max(100)
})

export const decisionSchema = z.object({
  decision: z.enum(['publish', 'reject']),
  reviewNote: z.string().trim().max(1000).default('')
})

export const exceptionSchema = z.object({
  occurrenceKey: z.string().datetime(),
  action: z.enum(['cancel', 'override']),
  overrideStartLocal: z.string().datetime({ local: true }).nullable().default(null),
  overrideEndLocal: z.string().datetime({ local: true }).nullable().default(null),
  overrideTimezone: z.string().trim().max(80).nullable().default(null),
  note: z.string().trim().max(300).default('')
}).superRefine((value, context) => {
  if (value.action === 'override' && (!value.overrideStartLocal || !value.overrideEndLocal || !value.overrideTimezone)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '改期必须填写新的开始、结束时间和时区' })
  }
})

export const calendarContentSelectionSchema = z.object({
  meetings: z.boolean().default(true),
  ppa: z.boolean().default(true),
  competition: z.boolean().default(true),
  bonus: z.boolean().default(true)
})

export type CalendarContentSelection = z.infer<typeof calendarContentSelectionSchema>

export const defaultCalendarContentSelection: CalendarContentSelection = {
  meetings: true,
  ppa: true,
  competition: true,
  bonus: true
}

export const calendarFeedSchema = z.object({
  alarmMinutes: z.union([z.literal(0), z.literal(10), z.literal(30), z.literal(60), z.literal(1440)]).default(30),
  contentSelection: calendarContentSelectionSchema.default(defaultCalendarContentSelection)
})

export const replayStatusSchema = z.enum(['pending', 'published', 'rejected', 'disabled'])
export const replayProviderSchema = z.enum(['baidu', 'quark', 'aliyun', 'onedrive', 'google_drive', 'dropbox', 'weiyun', 'other'])
export const replayOccurrenceQuerySchema = z.object({
  eventId: z.string().uuid(),
  occurrenceKey: z.string().datetime()
})

export const replayInputSchema = z.object({
  groupId: z.string().uuid().nullable().default(null),
  eventId: z.string().uuid().nullable().default(null),
  occurrenceKey: z.string().datetime().nullable().default(null),
  title: z.string().trim().min(2).max(120),
  meetingDate: calendarDateSchema,
  shareUrl: safeHttpsUrl,
  accessCode: z.string().trim().max(64).default(''),
  note: z.string().trim().max(500).default('')
}).superRefine((value, context) => {
  if (Boolean(value.eventId) !== Boolean(value.occurrenceKey)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['eventId'], message: '关联会议和具体场次必须同时提供' })
  }
})

export const replayAdminUpdateSchema = z.object({
  targetGroupId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(2).max(120),
  meetingDate: calendarDateSchema,
  shareUrl: safeHttpsUrl,
  accessCode: z.string().trim().max(64).default(''),
  note: z.string().trim().max(500).default('')
})

export const replayReportSchema = z.object({
  reason: z.enum(['unavailable', 'invalid_code', 'content_mismatch', 'other']),
  note: z.string().trim().max(300).default('')
})

export const replayReportResolutionSchema = z.object({
  resolution: z.enum(['resolved', 'dismissed'])
})

export const identityPreferenceSchema = z.object({
  publicWqId: z.boolean()
})

export const importantItemKindSchema = z.enum(['ppa', 'competition', 'bonus'])
export const importantItemStatusSchema = z.enum(['draft', 'pending', 'published', 'rejected', 'cancelled'])

function markdownLinkIsSafe(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

const markdownContentSchema = z.string().trim().max(8000).superRefine((value, context) => {
  if (/!\[[^\]]*\]\([^)]*\)/.test(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '重要事项内容不支持图片' })
  }
  for (const match of value.matchAll(/(?<!!)\[[^\]]*\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g)) {
    if (!markdownLinkIsSafe(match[1]!)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Markdown 链接仅支持不包含账号密码的 HTTPS 地址' })
    }
  }
})

export const importantItemInputSchema = z.object({
  kind: importantItemKindSchema,
  title: z.string().trim().min(2).max(120),
  contentMarkdown: markdownContentSchema.default(''),
  startDate: calendarDateSchema,
  endDate: calendarDateSchema,
  announcementDate: calendarDateSchema.nullable().default(null),
  paymentDate: calendarDateSchema.nullable().default(null)
}).superRefine((value, context) => {
  if (value.endDate < value.startDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: '结束日期不能早于开始日期' })
  }
  if (value.kind !== 'bonus' && !value.contentMarkdown) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['contentMarkdown'], message: '请填写事项内容' })
  }
  if (value.kind !== 'bonus' && (value.announcementDate || value.paymentDate)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['announcementDate'], message: '只有奖金日程可以设置公布和账单日期' })
  }
})

export type MeetingInput = z.infer<typeof meetingInputSchema>
export type EventStatus = z.infer<typeof eventStatusSchema>
export type Recurrence = z.infer<typeof recurrenceSchema>
export type MemberImportRow = z.infer<typeof memberImportRowSchema>
export type ReplayInput = z.infer<typeof replayInputSchema>
export type ReplayStatus = z.infer<typeof replayStatusSchema>
export type ReplayProvider = z.infer<typeof replayProviderSchema>
export type ImportantItemKind = z.infer<typeof importantItemKindSchema>
export type ImportantItemStatus = z.infer<typeof importantItemStatusSchema>
export type ImportantItemInput = z.infer<typeof importantItemInputSchema>

export interface ImportantItem {
  id: string
  uid: string
  status: ImportantItemStatus
  kind: ImportantItemKind
  title: string
  contentMarkdown: string
  startDate: string
  endDate: string
  announcementDate: string | null
  paymentDate: string | null
  submittedByMember: boolean
  sequence: number
  reviewNote: string
  createdAt: string
  updatedAt: string
}

export interface MeetingOccurrence {
  eventId: string
  occurrenceKey: string
  title: string
  summary: string
  organizer: string
  speaker: string
  category: string
  meetingLanguage: 'zh' | 'en' | 'bilingual' | 'other'
  locationType: 'online' | 'offline' | 'hybrid'
  locationText: string
  registrationUrl: string
  sourceTimezone: string
  startUtc: string
  endUtc: string
  status: 'published' | 'cancelled'
  isException: boolean
  hasReplay: boolean
}

export interface LeaderboardEntry {
  rank: number
  memberId: string
  wqId: string
  hasFullWqId: boolean
  country: string
  submissionCount: number
  approvedCount: number
  approvalRate: number
  isCurrentUser: boolean
}

export interface ReplayLeaderboardEntry extends LeaderboardEntry {
  contributedMeetingCount: number
}

export interface ReplayLink {
  id: string
  provider: ReplayProvider
  providerLabel: string
  shareUrl: string
  accessCode: string
  note: string
  contributorWqId: string
  contributorHasFullWqId: boolean
  openReportCount: number
  reportedByMe: boolean
}

export interface ReplayGroup {
  id: string
  eventId: string | null
  occurrenceKey: string | null
  title: string
  meetingDate: string
  links: ReplayLink[]
}

export interface ReplaySubmission {
  id: string
  groupId: string
  title: string
  meetingDate: string
  provider: ReplayProvider
  providerLabel: string
  shareUrl: string
  accessCode: string
  note: string
  status: ReplayStatus
  reviewNote: string
  createdAt: string
  approvedAt: string | null
}

export interface SessionUser {
  role: 'member' | 'admin'
  memberId: string | null
  wqIdHint: string
  country: string | null
  publicWqId: boolean | null
  passwordChangeRequired: boolean
  expiresAt: string
}

export interface ApiErrorShape {
  error: {
    code: string
    message: string
    fieldErrors?: Record<string, string[]>
    requestId: string
  }
}
