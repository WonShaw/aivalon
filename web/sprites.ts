// 圆桌上用到的像素图：队长旗、投票牌、任务据点、旗子、马车。画法和头像一样（shared/avatars.ts）：
// 每个字符一个像素，按调色板上色，"." 透明。多帧的用来做简单的帧动画
import { BASE_PALETTE } from '../shared/avatars.ts';

export interface Sprite {
  palette: Record<string, string>;
  rows: string[];
}

const sprite = (palette: Record<string, string>, rows: string[]): Sprite => ({ palette: { ...BASE_PALETTE, ...palette }, rows });

// 队长旗：潘德拉贡的红底金龙旗，两帧飘动
const BANNER_PALETTE = { p: '#8a5a2b' };
export const BANNER: Sprite[] = [
  sprite(BANNER_PALETTE, [
    'g.........',
    'prrrrrrr..',
    'prrgrrrrr.',
    'prggggrrr.',
    'prrgggrrr.',
    'prrrgrrrr.',
    'prrrrrrr..',
    'prr.rrr...',
    'pr...r....',
    'p.........',
    'p.........',
    'p.........',
  ]),
  sprite(BANNER_PALETTE, [
    'g.........',
    'prrrrrr...',
    'prrrgrrrr.',
    'prrggggrrr',
    'prrrgggrr.',
    'prrrrgrrr.',
    'prrrrrrr..',
    'pr.rrr.r..',
    'p...r.....',
    'p.........',
    'p.........',
    'p.........',
  ]),
];

// 投票牌：赞成举剑，反对举盾（盾上一个叉）
export const VOTE_SWORD = sprite({ b: '#6b4423', h: '#7a8794', a: '#c9d1d9' }, [
  '....w....',
  '...wah...',
  '...wah...',
  '...wah...',
  '...wah...',
  '.ggggggg.',
  '....b....',
  '....b....',
  '...ggg...',
]);

export const VOTE_SHIELD = sprite({ x: '#8f1d1d' }, [
  'kkkkkkkkk',
  'kwwwwwwwk',
  'kwxwwwxwk',
  'kwwxwxwwk',
  'kwwwxwwwk',
  'kwwxwxwwk',
  'kwxwwwxwk',
  '.kwwwwwk.',
  '..kwwwk..',
  '...kkk...',
]);

// 任务据点：一座石塔
export const TOWER = sprite({ a: '#a3abb5', A: '#6b737c', d: '#3a2a1a' }, [
  '................',
  '..kkk.kkkk.kkk..',
  '..kak.kaak.kak..',
  '..kakkkaakkkak..',
  '..kaaaaaaaaaak..',
  '..kAAAAAAAAAAk..',
  '...kaaaaaaaak...',
  '...kaaakkaaak...',
  '...kaaakkaaak...',
  '...kaaaaaaaak...',
  '...kAaaaaaaAk...',
  '...kaaakkaaak...',
  '...kaakddkaak...',
  '...kaakddkaak...',
  '..kkkkkkkkkkkk..',
  '................',
]);

// 任务结束后插在塔顶的旗：成功蓝旗，失败红旗
const flag = (color: string) =>
  sprite({ f: color, p: '#5a3a1a' }, ['pff...', 'pffff.', 'pfffff', 'pffff.', 'pff...', 'p.....', 'p.....', 'p.....']);
export const FLAG_GOOD = flag('#4f8cff');
export const FLAG_EVIL = flag('#ef5a5a');

// 出征的马车：两帧，车轮和马腿交替
const WAGON_PALETTE = { W: '#c9c2ad', c: '#8a5a2b', C: '#5a3a1a', h: '#a0683a', H: '#4a2c14', a: '#c9a36a', A: '#5a3a1a' };
const WAGON_TOP = [
  '..kkkkkkkkk...........',
  '.kwwwwwwwwwk..........',
  'kwwWwwWwwWwwk.....kk..',
  'kwwWwwWwwWwwk....kHhk.',
  'kwwWwwWwwWwwk...kHhhek',
  'kccccccccccckk.kHhhkk.',
  'kcCcCcCcCcCck.khhhhk..',
  'kccccccccccckkkhhhhhk.',
  '.kkkkkkkkkkk..khhhhhk.',
];
export const WAGON: Sprite[] = [
  sprite(WAGON_PALETTE, [
    ...WAGON_TOP,
    '.kak....kak...khk.khk.',
    'kaAak..kaAak..khk.khk.',
    '.kak....kak...kk..kk..',
  ]),
  sprite(WAGON_PALETTE, [
    ...WAGON_TOP,
    '.kAk....kAk...hk...hk.',
    'kAaAk..kAaAk.khk..khk.',
    '.kAk....kAk..kk...kk..',
  ]),
];
