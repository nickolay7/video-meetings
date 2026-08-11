import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClaudeModule } from '../claude/claude.module';
import { FilesModule } from '../files/files.module';
import { TasksModule } from '../tasks/tasks.module';
import { McpModule } from '../mcp/mcp.module';
import { InsightsController } from './insights.controller';
import { InsightsGeneratorService } from './insights-generator.service';
import { InsightsRepository } from './insights.repository';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret-key',
    }),
    FilesModule,
    ClaudeModule,
    TasksModule,
    McpModule,
  ],
  controllers: [InsightsController],
  providers: [JwtAuthGuard, InsightsGeneratorService, InsightsRepository],
  exports: [InsightsGeneratorService, InsightsRepository],
})
export class InsightsModule {}
