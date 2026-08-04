import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_SETTINGS,
  parseSaveEnvelope,
  parseSettings,
  SAVE_SCHEMA_VERSION,
  type AppSettings,
  type SaveEnvelope,
  type SaveLoadResult,
  type SaveSnapshot,
  type SaveWriteResult,
} from '../shared/save';

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export class PersistenceService {
  private readonly savesDirectory: string;
  private readonly primarySavePath: string;
  private readonly backupSavePath: string;
  private readonly temporarySavePath: string;
  private readonly settingsPath: string;
  private readonly temporarySettingsPath: string;

  constructor(userDataPath: string) {
    this.savesDirectory = path.join(userDataPath, 'saves');
    this.primarySavePath = path.join(this.savesDirectory, 'habitat.json');
    this.backupSavePath = path.join(
      this.savesDirectory,
      'habitat.backup.json',
    );
    this.temporarySavePath = path.join(
      this.savesDirectory,
      'habitat.tmp.json',
    );
    this.settingsPath = path.join(userDataPath, 'settings.json');
    this.temporarySettingsPath = path.join(userDataPath, 'settings.tmp.json');
  }

  async loadSave(): Promise<SaveLoadResult> {
    const primary = parseSaveEnvelope(await readJson(this.primarySavePath));
    if (primary) return { envelope: primary, source: 'primary' };

    const backup = parseSaveEnvelope(await readJson(this.backupSavePath));
    if (backup) {
      return {
        envelope: backup,
        source: 'backup',
        warning: '主存档不可读，已从备份恢复。',
      };
    }
    return {
      envelope: null,
      source: 'default',
      warning: '没有可读存档，已创建默认栖息地。',
    };
  }

  async writeSave(
    snapshot: SaveSnapshot,
    appVersion: string,
  ): Promise<SaveWriteResult> {
    const savedAt = new Date().toISOString();
    const envelope: SaveEnvelope = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      appVersion,
      savedAt,
      data: { ...snapshot, lastOnlineAt: savedAt },
    };
    await mkdir(this.savesDirectory, { recursive: true });
    await writeFile(
      this.temporarySavePath,
      `${JSON.stringify(envelope, null, 2)}\n`,
      'utf8',
    );

    if (!parseSaveEnvelope(await readJson(this.temporarySavePath))) {
      await rm(this.temporarySavePath, { force: true });
      throw new Error('DeskHabitat temporary save validation failed.');
    }

    const currentPrimary = parseSaveEnvelope(await readJson(this.primarySavePath));
    if (currentPrimary) {
      await rm(this.backupSavePath, { force: true });
      await rename(this.primarySavePath, this.backupSavePath);
    } else {
      await rm(this.primarySavePath, { force: true });
    }
    await rename(this.temporarySavePath, this.primarySavePath);
    return { savedAt };
  }

  async loadSettings(): Promise<AppSettings> {
    return (
      parseSettings(await readJson(this.settingsPath)) ?? { ...DEFAULT_SETTINGS }
    );
  }

  async updateSettings(
    patch: Partial<Omit<AppSettings, 'schemaVersion'>>,
  ): Promise<AppSettings> {
    const current = await this.loadSettings();
    const candidate = parseSettings({ ...current, ...patch });
    if (!candidate) throw new TypeError('Invalid DeskHabitat settings patch.');
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    await writeFile(
      this.temporarySettingsPath,
      `${JSON.stringify(candidate, null, 2)}\n`,
      'utf8',
    );
    await rm(this.settingsPath, { force: true });
    await rename(this.temporarySettingsPath, this.settingsPath);
    return candidate;
  }
}
