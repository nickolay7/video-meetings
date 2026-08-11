import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FilesModule } from '../files/files.module';
import { InsightsModule } from '../insights/insights.module';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionService } from './transcription.service';
import { TranscriptionRepository } from './transcription.repository';
import { SPEECH_TRANSCRIBER } from './speech-transcriber.interface';
import { WhisperTranscriber } from './whisper-transcriber';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret-key',
    }),
    FilesModule,
    InsightsModule,
  ],
  controllers: [TranscriptionController],
  providers: [
    JwtAuthGuard,
    TranscriptionService,
    TranscriptionRepository,
    { provide: SPEECH_TRANSCRIBER, useClass: WhisperTranscriber },
  ],
  exports: [TranscriptionRepository],
})
export class TranscriptionModule {}
