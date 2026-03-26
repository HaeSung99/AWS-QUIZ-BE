import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Question, QuestionSchema } from '../admin/schemas/question.schema';
import { User } from '../users/user.entity';
import { AnalyticsService } from './analytics.service';
import { VisitLog } from './entities/visit-log.entity';
import { WorkbookAttempt } from './entities/workbook-attempt.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, VisitLog, WorkbookAttempt]),
    MongooseModule.forFeature([{ name: Question.name, schema: QuestionSchema }]),
  ],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
