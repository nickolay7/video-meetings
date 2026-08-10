import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MeetingsModule } from './meetings/meetings.module';
import { FilesModule } from './files/files.module';
import { ProfileModule } from './profile/profile.module';
import { TranscriptionModule } from './transcription/transcription.module';
import { ClaudeModule } from './claude/claude.module';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    MeetingsModule,
    FilesModule,
    ProfileModule,
    TranscriptionModule,
    ClaudeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
