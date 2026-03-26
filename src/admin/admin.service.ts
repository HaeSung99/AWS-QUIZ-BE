import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateNoticeDto } from './dto/create-notice.dto';
import { CreateQuestionItemDto } from './dto/create-question-item.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateNoticeDto } from './dto/update-notice.dto';
import { UpdateQuestionItemDto } from './dto/update-question-item.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { Notice, NoticeDocument } from './schemas/notice.schema';
import { QuestionItem, QuestionItemDocument } from './schemas/question-item.schema';
import { Question, QuestionDocument } from './schemas/question.schema';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Notice.name)
    private readonly noticeModel: Model<NoticeDocument>,
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
    @InjectModel(QuestionItem.name)
    private readonly questionItemModel: Model<QuestionItemDocument>,
  ) {}

  private toNoticeResponse(notice: NoticeDocument) {
    const createdAtRaw = notice.get('createdAt');
    const createdAt =
      createdAtRaw instanceof Date ? createdAtRaw.toISOString() : null;
    return {
      id: notice._id.toString(),
      title: notice.title,
      body: notice.body,
      pinned: notice.pinned,
      createdAt,
    };
  }

  private toQuestionResponse(question: QuestionDocument) {
    return {
      id: question._id.toString(),
      certificationType: question.certificationType,
      title: question.title,
      summary: question.summary,
      questionCount: question.questionCount,
    };
  }

  private toQuestionItemResponse(item: QuestionItemDocument) {
    return {
      id: item._id.toString(),
      questionId: item.questionId.toString(),
      questionNumber: item.questionNumber,
      questionDescription: item.questionDescription,
      choices: item.choices,
      answer: item.answer,
      hint: item.hint ?? '',
      difficulty: item.difficulty,
      questionCategory: item.questionCategory,
    };
  }

  async createNotice(dto: CreateNoticeDto) {
    const created = await this.noticeModel.create({
      title: dto.title,
      body: dto.body,
      pinned: dto.pinned ?? false,
    });
    return this.toNoticeResponse(created);
  }

  async getNotices() {
    const notices = await this.noticeModel
      .find()
      .sort({ pinned: -1, createdAt: -1 })
      .exec();
    return notices.map((notice) => this.toNoticeResponse(notice));
  }

  async updateNotice(noticeId: string, dto: UpdateNoticeDto) {
    const notice = await this.noticeModel.findById(noticeId).exec();
    if (!notice) {
      throw new NotFoundException('공지글을 찾을 수 없습니다.');
    }
    if (dto.title !== undefined) notice.title = dto.title;
    if (dto.body !== undefined) notice.body = dto.body;
    if (dto.pinned !== undefined) notice.pinned = dto.pinned;
    const saved = await notice.save();
    return this.toNoticeResponse(saved);
  }

  async deleteNotice(noticeId: string) {
    const notice = await this.noticeModel.findById(noticeId).exec();
    if (!notice) {
      throw new NotFoundException('공지글을 찾을 수 없습니다.');
    }
    await this.noticeModel.deleteOne({ _id: notice._id }).exec();
    return { success: true };
  }

  async createQuestion(dto: CreateQuestionDto) {
    const created = await this.questionModel.create({
      certificationType: dto.certificationType,
      title: dto.title,
      summary: dto.summary,
      questionCount: dto.questionCount,
    });
    return this.toQuestionResponse(created);
  }

  async getQuestions() {
    const questions = await this.questionModel
      .find()
      .sort({ createdAt: -1 })
      .exec();
    return questions.map((question) => this.toQuestionResponse(question));
  }

  async updateQuestion(questionId: string, dto: UpdateQuestionDto) {
    const question = await this.questionModel.findById(questionId).exec();
    if (!question) {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }
    if (dto.certificationType !== undefined) {
      question.certificationType = dto.certificationType;
    }
    if (dto.title !== undefined) question.title = dto.title;
    if (dto.summary !== undefined) question.summary = dto.summary;
    if (dto.questionCount !== undefined) question.questionCount = dto.questionCount;
    const saved = await question.save();
    return this.toQuestionResponse(saved);
  }

  async deleteQuestion(questionId: string) {
    const question = await this.questionModel.findById(questionId).exec();
    if (!question) {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }
    await this.questionItemModel.deleteMany({
      questionId: new Types.ObjectId(questionId),
    });
    await this.questionModel.deleteOne({ _id: question._id }).exec();
    return { success: true };
  }

  async createQuestionItem(questionId: string, dto: CreateQuestionItemDto) {
    const question = await this.questionModel.findById(questionId).exec();
    if (!question) {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }
    const lastItem = await this.questionItemModel
      .findOne({ questionId: new Types.ObjectId(questionId) })
      .sort({ questionNumber: -1 })
      .exec();
    const nextQuestionNumber = (lastItem?.questionNumber ?? 0) + 1;
    if (nextQuestionNumber > question.questionCount) {
      throw new BadRequestException(
        `문제집 최대 문항 수(${question.questionCount})를 초과할 수 없습니다.`,
      );
    }

    const created = await this.questionItemModel.create({
      questionId: question._id,
      questionNumber: nextQuestionNumber,
      questionDescription: dto.questionDescription,
      choices: dto.choices,
      answer: dto.answer,
      hint: dto.hint,
      difficulty: dto.difficulty,
      questionCategory: dto.questionCategory,
    });
    return this.toQuestionItemResponse(created);
  }

  async getQuestionItems(questionId: string) {
    const question = await this.questionModel.findById(questionId).exec();
    if (!question) {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }

    const items = await this.questionItemModel
      .find({ questionId: new Types.ObjectId(questionId) })
      .sort({ questionNumber: 1 })
      .exec();
    return items.map((item) => this.toQuestionItemResponse(item));
  }

  async updateQuestionItem(
    questionId: string,
    itemId: string,
    dto: UpdateQuestionItemDto,
  ) {
    const question = await this.questionModel.findById(questionId).exec();
    if (!question) {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }

    const item = await this.questionItemModel
      .findOne({
        _id: itemId,
        questionId: new Types.ObjectId(questionId),
      })
      .exec();

    if (!item) {
      throw new NotFoundException('문제를 찾을 수 없습니다.');
    }

    if (dto.questionNumber !== undefined) item.questionNumber = dto.questionNumber;
    if (dto.questionDescription !== undefined) {
      item.questionDescription = dto.questionDescription;
    }
    if (dto.choices !== undefined) item.choices = dto.choices;
    if (dto.answer !== undefined) item.answer = dto.answer;
    if (dto.hint !== undefined) item.hint = dto.hint;
    if (dto.difficulty !== undefined) item.difficulty = dto.difficulty;
    if (dto.questionCategory !== undefined) {
      item.questionCategory = dto.questionCategory;
    }

    const saved = await item.save();
    return this.toQuestionItemResponse(saved);
  }

  async deleteQuestionItem(questionId: string, itemId: string) {
    const question = await this.questionModel.findById(questionId).exec();
    if (!question) {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }

    const item = await this.questionItemModel
      .findOne({
        _id: itemId,
        questionId: new Types.ObjectId(questionId),
      })
      .exec();

    if (!item) {
      throw new NotFoundException('문제를 찾을 수 없습니다.');
    }

    const deletedNumber = item.questionNumber;
    await this.questionItemModel.deleteOne({ _id: item._id }).exec();
    await this.questionItemModel
      .updateMany(
        {
          questionId: new Types.ObjectId(questionId),
          questionNumber: { $gt: deletedNumber },
        },
        { $inc: { questionNumber: -1 } },
      )
      .exec();
    return { success: true };
  }
}
