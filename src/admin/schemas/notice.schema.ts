import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NoticeDocument = HydratedDocument<Notice>;

@Schema({ timestamps: true, collection: 'notices' })
export class Notice {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  body: string;

  @Prop({ default: false })
  pinned: boolean;
}

export const NoticeSchema = SchemaFactory.createForClass(Notice);
