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
import { InsightsModule } from './insights/insights.module';
import { TasksModule } from './tasks/tasks.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    MeetingsModule,
    FilesModule,
    ProfileModule,
    TranscriptionModule,
    ClaudeModule,
    InsightsModule,
    TasksModule,
    McpModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
