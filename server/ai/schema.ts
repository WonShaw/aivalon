import type { ActionSubmission, ActionType } from '../../shared/types.ts';

// 所有动作共用一个 schema：Agent SDK 用一个 StructuredOutput 工具实现结构化输出，
// 工具定义处在提示词最前面，如果每次调用换 schema，整段缓存都会失效。
export const ACTION_TYPES: ActionType[] = [
  'propose',
  'speak',
  'final_team',
  'vote',
  'mission',
  'evil_discuss',
  'assassinate',
  'reflect',
];

export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ACTION_TYPES,
      description: '本次执行的动作，必须与裁判要求的一致',
    },
    speech: {
      type: 'string',
      description: '公开发言，所有玩家都能看到',
    },
    team: {
      type: 'array',
      items: { type: 'integer', minimum: 1, maximum: 10 },
      description: '提名的队伍（座位号列表）',
    },
    vote: {
      type: 'string',
      enum: ['approve', 'reject'],
      description: '对队伍投票：approve 赞成 / reject 反对',
    },
    mission_card: {
      type: 'string',
      enum: ['success', 'fail'],
      description: '任务牌',
    },
    target: {
      type: 'integer',
      minimum: 1,
      maximum: 10,
      description: '刺杀目标的座位号',
    },
  },
  required: ['action'],
  additionalProperties: false,
} as const;

export type AIOutput = ActionSubmission;
