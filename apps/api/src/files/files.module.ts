import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MeetingsModule } from '../meetings/meetings.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FilesRepository } from './files.repository';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret-key',
    }),
    MeetingsModule,
  ],
  controllers: [FilesController],
  providers: [JwtAuthGuard, FilesService, FilesRepository],
  exports: [FilesService],
})
export class FilesModule {}
