import {
  BadRequestException,
  Controller,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
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
}
