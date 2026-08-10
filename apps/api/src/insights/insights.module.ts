import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FilesModule } from '../files/files.module';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { InsightsRepository } from './insights.repository';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret-key',
    }),
    FilesModule,
  ],
  controllers: [InsightsController],
  providers: [JwtAuthGuard, InsightsService, InsightsRepository],
  exports: [InsightsService, InsightsRepository],
})
export class InsightsModule {}
