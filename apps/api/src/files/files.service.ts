import { Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, writeFile, readFile } from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { FilesRepository } from './files.repository';
import { MeetingFile } from './meeting-file.entity';
import { getUploadsDir } from './files.constants';

/**
 * Оставляет только «голое» имя файла: убирает произвольные пути (`../`, `C:\`, вложенные
 * каталоги через `/`/`\`) и служебные символы, опасные для файловой системы.
 * Пустое имя сводится к безопасному `unnamed`.
 */
function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[\\/\0]/g, '');
  return base.trim() || 'unnamed';
}

@Injectable()
export class FilesService {
  constructor(
    private readonly filesRepository: FilesRepository,
    private readonly meetingsRepository: MeetingsRepository,
  ) {}

  async upload(meetingId: string, file: Express.Multer.File): Promise<MeetingFile> {
    await this.assertMeetingExists(meetingId);

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

  async list(meetingId: string): Promise<MeetingFile[]> {
    await this.assertMeetingExists(meetingId);
    return this.filesRepository.findByMeetingId(meetingId);
  }

  /**
   * Возвращает метаданные файла в контексте встречи (используется транскрибацией):
   * 404, если встреча не существует, файл не найден или принадлежит другой встрече.
   */
  async findForMeeting(meetingId: string, fileId: string): Promise<MeetingFile> {
    await this.assertMeetingExists(meetingId);
    const file = await this.filesRepository.findById(fileId);
    if (!file || file.meetingId !== meetingId) {
      throw new NotFoundException(`File with id ${fileId} not found`);
    }
    return file;
  }

  /** Возвращает файл и его содержимое с диска для скачивания. */
  async download(
    meetingId: string,
    fileId: string,
  ): Promise<{ file: MeetingFile; content: Buffer }> {
    await this.assertMeetingExists(meetingId);
    const file = await this.filesRepository.findById(fileId);
    // Файл ищем в контексте встречи: чужой fileId для встречи тоже даёт 404.
    if (!file || file.meetingId !== meetingId) {
      throw new NotFoundException(`File with id ${fileId} not found`);
    }

    let content: Buffer;
    try {
      content = await readFile(path.join(getUploadsDir(), meetingId, file.storedName));
    } catch {
      // Метаданные остались, а файл на диске удалён/осиротел — считаем его отсутствующим.
      throw new NotFoundException(`File with id ${fileId} not found`);
    }
    return { file, content };
  }

  private async assertMeetingExists(meetingId: string): Promise<void> {
    const meeting = await this.meetingsRepository.findById(meetingId);
    if (!meeting) {
      throw new NotFoundException(`Meeting with id ${meetingId} not found`);
    }
  }
}
