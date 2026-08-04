import { Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { FilesRepository } from './files.repository';
import { MeetingFile } from './meeting-file.entity';
import { getUploadsDir, MAX_FILE_SIZE } from './files.constants';

/** Поля multer-файла из memoryStorage, которые использует сервис. */
export interface UploadedFileData {
  originalname: string;
  size: number;
  mimetype: string;
  buffer: Buffer;
}

/**
 * Оставляет только «голое» имя файла: убирает произвольные пути (`../`, `C:\`, вложенные
 * каталоги через `/`/`\`) и служебные символы, опасные для файловой системы.
 */
function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[\\/\0]/g, '');
  return base.trim();
}

@Injectable()
export class FilesService {
  constructor(
    private readonly filesRepository: FilesRepository,
    private readonly meetingsRepository: MeetingsRepository,
  ) {}

  async upload(meetingId: string, file: UploadedFileData): Promise<MeetingFile> {
    const meeting = await this.meetingsRepository.findById(meetingId);
    if (!meeting) {
      throw new NotFoundException(`Meeting with id ${meetingId} not found`);
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new PayloadTooLargeException('File exceeds the 20 MB limit');
    }

    const originalName = sanitizeFileName(file.originalname);
    // Уникальный префикс гарантирует, что два файла с одинаковым именем не перезапишут друг друга.
    const storedName = `${randomUUID()}-${originalName}`;

    const meetingDir = path.join(getUploadsDir(), meetingId);
    await mkdir(meetingDir, { recursive: true });
    await writeFile(path.join(meetingDir, storedName), file.buffer);

    return this.filesRepository.create({
      meetingId,
      originalName,
      storedName,
      size: file.size,
      mimeType: file.mimetype,
    });
  }
}
