import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MeetingsController } from './meetings.controller';
import { MeetingsRepository } from './meetings.repository';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret-key',
    }),
  ],
  controllers: [MeetingsController],
  providers: [JwtAuthGuard, MeetingsRepository],
})
export class MeetingsModule {}
