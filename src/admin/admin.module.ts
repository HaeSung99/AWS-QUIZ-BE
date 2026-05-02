import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsModule } from '../analytics/analytics.module';
import { QuestionEmbedding } from '../analytics/entities/question-embedding.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PublicController } from './public.controller';
import { Notice, NoticeSchema } from './schemas/notice.schema';
import { Question, QuestionSchema } from './schemas/question.schema';
import {
  QuestionItem,
  QuestionItemSchema,
} from './schemas/question-item.schema';

@Module({
  imports: [
    AnalyticsModule,
    TypeOrmModule.forFeature([QuestionEmbedding]),
    MongooseModule.forFeature([
      { name: Notice.name, schema: NoticeSchema },
      { name: Question.name, schema: QuestionSchema },
      { name: QuestionItem.name, schema: QuestionItemSchema },
    ]),
  ],
  controllers: [AdminController, PublicController],
  providers: [AdminService],
})
export class AdminModule {}
