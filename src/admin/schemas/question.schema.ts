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
}

export const QuestionSchema = SchemaFactory.createForClass(Question);
