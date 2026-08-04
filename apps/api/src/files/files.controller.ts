import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { Readable } from 'stream';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FilesService } from './files.service';
import { MeetingFile } from './meeting-file.entity';
import { MAX_FILE_SIZE } from './files.constants';

@Controller('meetings/:id/files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  async upload(
    @Param('id') meetingId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<MeetingFile> {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    return this.filesService.upload(meetingId, file);
  }

  @Get()
  async list(@Param('id') meetingId: string): Promise<MeetingFile[]> {
    return this.filesService.list(meetingId);
  }

  @Get(':fileId/download')
  async download(
    @Param('id') meetingId: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, content } = await this.filesService.download(meetingId, fileId);
    // Заголовки отдают исходное имя файла; убираем символы, ломающие заголовок.
    const filename = file.originalName.replace(/["\r\n]/g, '');
    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(file.size),
    });
    return new StreamableFile(Readable.from(content));
  }
}
