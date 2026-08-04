import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MeetingsModule } from './meetings/meetings.module';
import { FilesModule } from './files/files.module';

@Module({
  imports: [AuthModule, UsersModule, MeetingsModule, FilesModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
