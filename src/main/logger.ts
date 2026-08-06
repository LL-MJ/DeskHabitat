import {
  appendFile,
  mkdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

const MAX_LOG_BYTES = 512 * 1024;
const MAX_LOG_FILES = 3;

function serializeDetails(details: unknown): string {
  if (details instanceof Error) return details.stack ?? details.message;
  if (typeof details === 'string') return details;
  if (details === undefined) return '';
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

export class AppLogger {
  private readonly directory: string;
  private readonly activePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.directory = path.join(userDataPath, 'logs');
    this.activePath = path.join(this.directory, 'desk-habitat.log');
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await this.rotateIfNeeded();
  }

  write(level: LogLevel, message: string, details?: unknown): void {
    const safeMessage = message.replace(/[\r\n]+/g, ' ').slice(0, 2_000);
    const safeDetails = serializeDetails(details).replace(/\r/g, '').slice(0, 6_000);
    const suffix = safeDetails ? `\n${safeDetails}` : '';
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${safeMessage}${suffix}\n`;
    this.writeQueue = this.writeQueue
      .then(async () => {
        await this.rotateIfNeeded(Buffer.byteLength(line));
        await appendFile(this.activePath, line, 'utf8');
      })
      .catch((error: unknown) => {
        console.error('DeskHabitat log write failed.', error);
      });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private async rotateIfNeeded(incomingBytes = 0): Promise<void> {
    let shouldRotate: boolean;
    try {
      shouldRotate =
        (await stat(this.activePath)).size + incomingBytes > MAX_LOG_BYTES;
    } catch {
      return;
    }
    if (!shouldRotate) return;

    await rm(`${this.activePath}.${MAX_LOG_FILES}`, { force: true });
    for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
      try {
        await rename(`${this.activePath}.${index}`, `${this.activePath}.${index + 1}`);
      } catch {
        // Missing older generations are expected.
      }
    }
    await rename(this.activePath, `${this.activePath}.1`);
  }
}
