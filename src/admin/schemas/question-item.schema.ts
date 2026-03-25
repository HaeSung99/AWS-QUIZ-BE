import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Question } from './question.schema';

export type QuestionItemDocument = HydratedDocument<QuestionItem>;

@Schema({ timestamps: true, collection: 'question_items' })
export class QuestionItem {
  @Prop({
    type: Types.ObjectId,
    ref: Question.name,
    required: true,
    index: true,
  })
  questionId: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  questionNumber: number;

  @Prop({ required: true, trim: true })
  questionDescription: string;

  @Prop({ type: [String], required: true })
  choices: string[];

  @Prop({ required: true, trim: true })
  answer: string;

  @Prop({ trim: true })
  hint?: string;

  @Prop({ required: true, trim: true })
  difficulty: string;

  @Prop({ required: true, trim: true })
  questionCategory: string;
}

export const QuestionItemSchema = SchemaFactory.createForClass(QuestionItem);
