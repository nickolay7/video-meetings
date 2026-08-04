import { Injectable } from '@nestjs/common';
import { MeetingFile } from './meeting-file.entity';

@Injectable()
export class FilesRepository {
  private files: Map<string, MeetingFile> = new Map();
  private idCounter = 1;

  async create(params: {
    meetingId: string;
    originalName: string;
    storedName: string;
    size: number;
    mimeType: string;
  }): Promise<MeetingFile> {
    const id = String(this.idCounter++);
    const file = new MeetingFile(
      id,
      params.meetingId,
      params.originalName,
      params.storedName,
      params.size,
      params.mimeType,
      new Date(),
    );
    this.files.set(id, file);
    return file;
  }

  async clear(): Promise<void> {
    this.files.clear();
    this.idCounter = 1;
  }
}
