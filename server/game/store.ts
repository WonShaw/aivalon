import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameEvent, GameStatus, PlayerInfo, Role, Team } from '../../shared/types.ts';

// 游戏记录（含所有身份与私密信息）只由服务端读写，AI 进程无法访问
const DATA_DIR = join(import.meta.dirname, '..', '..', 'data', 'games');

export interface GameRecord {
  id: string;
  createdAt: number;
  status: GameStatus;
  winner?: Team;
  setup: Role[]; // 本局身份配置（早期的记录没有这个字段）
  players: PlayerInfo[];
  personas: Record<number, string>; // 座位 -> 给 AI 的性格描述
  roles: Record<number, Role>;
  firstLeader: number;
  sessions: Record<number, string | null>; // 座位 -> Agent SDK session id（只有 AI 座位）
  humanTokens: Record<number, string>; // 座位 -> 人类玩家的凭证
}

export class GameStore {
  constructor(private dir = DATA_DIR) {
    mkdirSync(this.dir, { recursive: true });
  }

  private gameDir(id: string): string {
    return join(this.dir, id);
  }

  saveRecord(record: GameRecord): void {
    mkdirSync(this.gameDir(record.id), { recursive: true });
    writeFileSync(join(this.gameDir(record.id), 'game.json'), JSON.stringify(record, null, 2));
  }

  appendEvent(id: string, event: GameEvent): void {
    appendFileSync(join(this.gameDir(id), 'events.jsonl'), JSON.stringify(event) + '\n');
  }

  loadRecord(id: string): GameRecord | null {
    const file = join(this.gameDir(id), 'game.json');
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8')) as GameRecord;
  }

  loadEvents(id: string): GameEvent[] {
    const file = join(this.gameDir(id), 'events.jsonl');
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as GameEvent);
  }

  listRecords(): GameRecord[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .map((id) => this.loadRecord(id))
      .filter((r): r is GameRecord => r !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}
