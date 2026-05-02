import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  QuestionItem,
  QuestionItemSchema,
} from '../admin/schemas/question-item.schema';
import { Question, QuestionSchema } from '../admin/schemas/question.schema';
import { User } from '../users/user.entity';
import { AnalyticsService } from './analytics.service';
import { QuestionAttempt } from './entities/question-attempt.entity';
import { QuestionEmbedding } from './entities/question-embedding.entity';
import { UserWeaknessComment } from './entities/user-weakness-comment.entity';
import { VisitLog } from './entities/visit-log.entity';
import { WorkbookAttempt } from './entities/workbook-attempt.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      VisitLog,
      WorkbookAttempt,
      QuestionAttempt,
      QuestionEmbedding,
      UserWeaknessComment,
    ]),
    MongooseModule.forFeature([
      { name: Question.name, schema: QuestionSchema },
      { name: QuestionItem.name, schema: QuestionItemSchema },
    ]),
  ],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
