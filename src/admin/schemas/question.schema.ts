import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type QuestionDocument = HydratedDocument<Question>;

@Schema({ timestamps: true, collection: 'questions' })
export class Question {
  @Prop({ required: true, trim: true })
  certificationType: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  summary: string;

  @Prop({ required: true, min: 1 })
  questionCount: number;

  /** draft=게시전(미노출), published=게시완료(이용자 노출). 생성 시 draft */
  @Prop({ type: String, enum: ['draft', 'published'], default: 'draft' })
  status: 'draft' | 'published';
}

export const QuestionSchema = SchemaFactory.createForClass(Question);
