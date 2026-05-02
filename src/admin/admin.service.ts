import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model, Types } from 'mongoose';
import OpenAI from 'openai';
import { Repository } from 'typeorm';
import { QuestionEmbedding } from '../analytics/entities/question-embedding.entity';
import { CreateNoticeDto } from './dto/create-notice.dto';
import { CreateQuestionItemDto } from './dto/create-question-item.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { RecommendQuestionCategoryDto } from './dto/recommend-question-category.dto';
import { UpdateNoticeDto } from './dto/update-notice.dto';
import { UpdateQuestionItemDto } from './dto/update-question-item.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { Notice, NoticeDocument } from './schemas/notice.schema';
import {
  QuestionItem,
  QuestionItemDocument,
} from './schemas/question-item.schema';
import { Question, QuestionDocument } from './schemas/question.schema';

@Injectable()
export class AdminService {
  private openAIClient: OpenAI | null = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(QuestionEmbedding)
    private readonly questionEmbeddingRepository: Repository<QuestionEmbedding>,
    @InjectModel(Notice.name)
    private readonly noticeModel: Model<NoticeDocument>,
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
    @InjectModel(QuestionItem.name)
    private readonly questionItemModel: Model<QuestionItemDocument>,
  ) {}

  private toIsoDate(value: unknown) {
    return value instanceof Date ? value.toISOString() : null;
  }

  private toNoticeResponse(notice: NoticeDocument) {
    const createdAt = this.toIsoDate(notice.get('createdAt') as unknown);
    return {
      id: notice._id.toString(),
      title: notice.title,
      body: notice.body,
      pinned: notice.pinned,
      createdAt,
    };
  }

  private toQuestionResponse(question: QuestionDocument) {
    const createdAt = this.toIsoDate(question.get('createdAt') as unknown);
    const updatedAt = this.toIsoDate(question.get('updatedAt') as unknown);
    return {
      id: question._id.toString(),
      certificationType: question.certificationType,
      title: question.title,
      summary: question.summary,
      questionCount: question.questionCount,
      status: question.status === 'draft' ? 'draft' : 'published',
      createdAt,
      updatedAt,
    };
  }

  private toPublicQuestionResponse(question: QuestionDocument) {
    const full = this.toQuestionResponse(question);
    return {
      id: full.id,
      certificationType: full.certificationType,
      title: full.title,
      summary: full.summary,
      questionCount: full.questionCount,
      createdAt: full.createdAt,
      updatedAt: full.updatedAt,
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

  private getOpenAIClient() {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');
    }
    if (!this.openAIClient) {
      this.openAIClient = new OpenAI({ apiKey });
    }
    return this.openAIClient;
  }

  private embeddingModel() {
    return (
      this.configService.get<string>('OPENAI_EMBEDDING_MODEL') ??
      'text-embedding-3-small'
    );
  }

  private embeddingDimensions() {
    const raw = Number(
      this.configService.get<string>('OPENAI_EMBEDDING_DIMENSIONS') ?? '512',
    );
    return Number.isFinite(raw) && raw > 0 ? raw : 512;
  }

  private cosineSimilarity(a: number[], b: number[]) {
    const length = Math.min(a.length, b.length);
    if (length === 0) return 0;

    let dot = 0;
    let aNorm = 0;
    let bNorm = 0;
    for (let i = 0; i < length; i += 1) {
      dot += a[i] * b[i];
      aNorm += a[i] * a[i];
      bNorm += b[i] * b[i];
    }
    if (aNorm === 0 || bNorm === 0) return 0;
    return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
  }

  private buildDraftQuestionText(dto: RecommendQuestionCategoryDto) {
    const choices = dto.choices?.filter(Boolean).join(' / ') || '없음';
    return [
      `문제: ${dto.questionDescription.trim()}`,
      `선택지: ${choices}`,
      `정답: ${dto.answer?.trim() || '없음'}`,
      `힌트: ${dto.hint?.trim() || '없음'}`,
      `난이도: ${dto.difficulty?.trim() || '없음'}`,
    ].join('\n');
  }

  private async createEmbedding(input: string) {
    const response = await this.getOpenAIClient().embeddings.create({
      model: this.embeddingModel(),
      input,
      dimensions: this.embeddingDimensions(),
    });
    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new ServiceUnavailableException('Embedding response is empty');
    }
    return embedding;
  }

  async recommendQuestionCategory(dto: RecommendQuestionCategoryDto) {
    // 1. 관리자 화면에서 작성 중인 문제 설명과 현재 사용 중인 카테고리 후보를 검증한다.
    const questionDescription = dto.questionDescription.trim();
    if (!questionDescription) {
      throw new BadRequestException('문제 설명을 입력해주세요.');
    }

    const allowedCategories = dto.categories
      .map((category) => category.value.trim())
      .filter((category) => category.length > 0);
    if (allowedCategories.length === 0) {
      throw new BadRequestException(
        '추천할 기존 카테고리가 없습니다. 먼저 카테고리를 직접 작성해 저장해주세요.',
      );
    }
    const allowedCategorySet = new Set(allowedCategories);

    // 2. 작성 중인 문제를 임베딩해서 기존 문제 임베딩과 비교할 기준 벡터로 사용한다.
    const draftQuestionText = this.buildDraftQuestionText({
      ...dto,
      questionDescription,
    });
    const draftEmbedding = await this.createEmbedding(draftQuestionText);

    // 3. 기존 문제에서 실제 사용 중인 카테고리만 추천 후보로 삼는다.
    const existingEmbeddings = await this.questionEmbeddingRepository.find();
    const similarRows = existingEmbeddings
      .filter((row) => allowedCategorySet.has(row.questionCategory))
      .map((row) => ({
        category: row.questionCategory,
        similarity: this.cosineSimilarity(draftEmbedding, row.embedding),
      }))
      .filter((row) => row.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 30);

    if (similarRows.length === 0) {
      throw new ServiceUnavailableException(
        '비교할 기존 문제 임베딩이 없습니다. 먼저 기존 문제 임베딩을 생성해주세요.',
      );
    }

    // 4. 유사한 기존 문제들을 카테고리별로 묶어 최고 유사도, 평균 유사도, 유사 문제 수를 누적한다.
    const categoryScores = new Map<
      string,
      { count: number; maxSimilarity: number; sumSimilarity: number }
    >();
    for (const row of similarRows) {
      const current = categoryScores.get(row.category) ?? {
        count: 0,
        maxSimilarity: 0,
        sumSimilarity: 0,
      };
      current.count += 1;
      current.maxSimilarity = Math.max(current.maxSimilarity, row.similarity);
      current.sumSimilarity += row.similarity;
      categoryScores.set(row.category, current);
    }

    // 5. 최고 유사도 60%, 평균 유사도 30%, 유사 문제 수 10%로 최종 점수를 계산해 Top 3만 반환한다.
    return [...categoryScores.entries()]
      .map(([category, score]) => {
        const averageSimilarity = score.sumSimilarity / score.count;
        const countBoost = Math.min(score.count / 10, 1);
        const finalScore =
          score.maxSimilarity * 0.6 +
          averageSimilarity * 0.3 +
          countBoost * 0.1;
        return {
          category,
          score: Number(finalScore.toFixed(4)),
          maxSimilarity: Number(score.maxSimilarity.toFixed(4)),
          averageSimilarity: Number(averageSimilarity.toFixed(4)),
          similarQuestionCount: score.count,
          reason: `기존 ${category} 문제 ${score.count}개와 유사합니다. 최고 유사도 ${score.maxSimilarity.toFixed(2)}, 평균 유사도 ${averageSimilarity.toFixed(2)} 기준입니다.`,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  async getUsedQuestionCategories() {
    // 1. 실제 저장된 문항에서 사용 중인 카테고리만 모아 관리자 입력 후보로 제공한다.
    const categories = await this.questionItemModel
      .distinct<string>('questionCategory', {
        questionCategory: { $exists: true, $ne: '' },
      })
      .exec();

    // 2. 공백과 중복을 정리해서 화면에서 바로 select/datalist 후보로 쓸 수 있게 반환한다.
    return [
      ...new Set(
        categories
          .filter((category): category is string => typeof category === 'string')
          .map((category) => category.trim()),
      ),
    ]
      .filter((category) => category.length > 0)
      .sort((a, b) => a.localeCompare(b, 'ko'));
  }

  async createNotice(dto: CreateNoticeDto) {
    // 1. 공지 입력값을 그대로 저장하고, 관리자 화면 응답 형태로 반환한다.
    const created = await this.noticeModel.create({
      title: dto.title,
      body: dto.body,
      pinned: dto.pinned ?? false,
    });
    return this.toNoticeResponse(created);
  }

  async getNotices() {
    // 1. 고정 공지를 먼저 보여주고, 같은 우선순위에서는 최신순으로 정렬한다.
    const notices = await this.noticeModel
      .find()
      .sort({ pinned: -1, createdAt: -1 })
      .exec();
    return notices.map((notice) => this.toNoticeResponse(notice));
  }

  async updateNotice(noticeId: string, dto: UpdateNoticeDto) {
    // 1. 수정 대상 공지를 찾고, 없는 ID면 관리자에게 명확히 알려준다.
    const notice = await this.noticeModel.findById(noticeId).exec();
    if (!notice) {
      throw new NotFoundException('공지글을 찾을 수 없습니다.');
    }

    // 2. 전달된 필드만 덮어써서 부분 수정이 가능하게 한다.
    if (dto.title !== undefined) notice.title = dto.title;
    if (dto.body !== undefined) notice.body = dto.body;
    if (dto.pinned !== undefined) notice.pinned = dto.pinned;

    // 3. 저장 후 화면에서 쓰는 응답 형태로 반환한다.
    const saved = await notice.save();
    return this.toNoticeResponse(saved);
  }

  async deleteNotice(noticeId: string) {
    // 1. 삭제 대상 공지를 확인한 뒤 실제 삭제한다.
    const notice = await this.noticeModel.findById(noticeId).exec();
    if (!notice) {
      throw new NotFoundException('공지글을 찾을 수 없습니다.');
    }
    await this.noticeModel.deleteOne({ _id: notice._id }).exec();
    return { success: true };
  }

  async createQuestion(dto: CreateQuestionDto) {
    // 1. 문제집 기본 정보를 만들고, 검수 전 상태인 draft로 시작한다.
    const created = await this.questionModel.create({
      certificationType: dto.certificationType,
      title: dto.title,
      summary: dto.summary,
      questionCount: dto.questionCount,
      status: 'draft',
    });
    return this.toQuestionResponse(created);
  }

  async getQuestions() {
    // 1. 관리자 편집 화면에서는 draft를 포함한 전체 문제집을 최신 수정순으로 보여준다.
    const questions = await this.questionModel
      .find()
      .sort({ updatedAt: -1 })
      .exec();
    return questions.map((question) => this.toQuestionResponse(question));
  }

  async getPublicQuestions() {
    // 1. 이용자 화면에는 게시된 문제집만 노출한다.
    const questions = await this.questionModel
      .find({ status: { $ne: 'draft' } })
      .sort({ updatedAt: -1, createdAt: -1 })
      .exec();

    return questions.map((question) => this.toPublicQuestionResponse(question));
  }

  async updateQuestion(questionId: string, dto: UpdateQuestionDto) {
    // 1. 수정할 문제집을 먼저 찾는다.
    const question = await this.questionModel.findById(questionId).exec();
    if (!question) {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }

    // 2. 전달된 필드만 반영해서 제목, 요약, 문항 수, 게시 상태를 부분 수정한다.
    if (dto.certificationType !== undefined) {
      question.certificationType = dto.certificationType;
    }
    if (dto.title !== undefined) question.title = dto.title;
    if (dto.summary !== undefined) question.summary = dto.summary;
    if (dto.questionCount !== undefined)
      question.questionCount = dto.questionCount;
    if (dto.status !== undefined) question.status = dto.status;

    // 3. 저장 후 관리자 화면 응답 형태로 반환한다.
    const saved = await question.save();
    return this.toQuestionResponse(saved);
  }

  async deleteQuestion(questionId: string) {
    // 1. 문제집이 존재하는지 확인하고, 하위 문항까지 함께 삭제한다.
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
    // 1. 문제집이 존재하는지 확인한다.
    const question = await this.questionModel.findById(questionId).exec();
    if (!question) {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }

    // 2. 다음 문항 번호를 계산하고, 문제집의 최대 문항 수를 넘지 않게 막는다.
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

    // 3. 문항을 생성하고, 화면에서 쓰는 응답 형태로 반환한다.
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
    // 1. 관리자 화면에서 선택한 문제집이 존재하는지 확인한다.
    const question = await this.questionModel.findById(questionId).exec();
    if (!question) {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }

    // 2. 문항을 번호순으로 조회해 편집 화면에서 바로 사용할 수 있게 반환한다.
    const items = await this.questionItemModel
      .find({ questionId: new Types.ObjectId(questionId) })
      .sort({ questionNumber: 1 })
      .exec();
    return items.map((item) => ({
      ...this.toQuestionItemResponse(item),
      certificationType: question.certificationType,
    }));
  }

  /** 공개(비로그인·일반) 퀴즈: 게시됨 + 문항 수 충족 시에만 */
  async getPublicQuestionItems(questionId: string) {
    // 1. 공개 문제집만 조회 가능하다. draft는 존재하지 않는 것처럼 응답한다.
    const question = await this.questionModel.findById(questionId).exec();
    if (!question) {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }
    if (question.status === 'draft') {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }

    // 2. 등록 문항 수가 문제집 설정 수보다 적으면 공개 풀이를 막는다.
    const items = await this.questionItemModel
      .find({ questionId: new Types.ObjectId(questionId) })
      .sort({ questionNumber: 1 })
      .exec();
    if (items.length < question.questionCount) {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }
    return items.map((item) => this.toQuestionItemResponse(item));
  }

  async getPublicQuestionItemsByCategory(category: string, limit = 20) {
    const trimmedCategory = category.trim();
    if (!trimmedCategory) {
      throw new BadRequestException('유형을 입력해주세요.');
    }

    // 1. 공개된 문제집의 문항만 유형별 연습 후보로 사용한다.
    const publishedQuestions = await this.questionModel
      .find({ status: { $ne: 'draft' } })
      .select({ _id: 1, certificationType: 1 })
      .lean()
      .exec();
    const publishedQuestionIds = publishedQuestions.map(
      (question) => question._id,
    );
    if (publishedQuestionIds.length === 0) return [];

    const safeLimit = Number.isFinite(limit)
      ? Math.min(Math.max(limit, 1), 100)
      : 20;

    // 2. 같은 유형 문항을 최신순으로 가져오고, 유형별 풀이 화면용 번호를 다시 매긴다.
    const items = await this.questionItemModel
      .find({
        questionId: { $in: publishedQuestionIds },
        questionCategory: trimmedCategory,
      })
      .sort({ updatedAt: -1, questionNumber: 1 })
      .limit(safeLimit)
      .exec();

    return items.map((item, index) => ({
      ...this.toQuestionItemResponse(item),
      questionNumber: index + 1,
      certificationType:
        publishedQuestions.find(
          (question) => String(question._id) === item.questionId.toString(),
        )?.certificationType ?? null,
    }));
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

    // 2. 해당 문제집에 속한 문항만 수정할 수 있게 문항과 문제집 ID를 함께 조건으로 건다.
    const item = await this.questionItemModel
      .findOne({
        _id: itemId,
        questionId: new Types.ObjectId(questionId),
      })
      .exec();

    if (!item) {
      throw new NotFoundException('문제를 찾을 수 없습니다.');
    }

    // 3. 전달된 필드만 반영해서 기존 문항의 나머지 정보는 유지한다.
    if (dto.questionNumber !== undefined)
      item.questionNumber = dto.questionNumber;
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

    // 4. 저장 후 관리자 화면에서 쓰는 응답 형태로 반환한다.
    const saved = await item.save();
    return this.toQuestionItemResponse(saved);
  }

  async deleteQuestionItem(questionId: string, itemId: string) {
    // 1. 문제집이 존재하는지 먼저 확인한다.
    const question = await this.questionModel.findById(questionId).exec();
    if (!question) {
      throw new NotFoundException('문제집을 찾을 수 없습니다.');
    }

    // 2. 해당 문제집에 속한 삭제 대상 문항을 찾는다.
    const item = await this.questionItemModel
      .findOne({
        _id: itemId,
        questionId: new Types.ObjectId(questionId),
      })
      .exec();

    if (!item) {
      throw new NotFoundException('문제를 찾을 수 없습니다.');
    }

    // 3. 문항을 삭제하고, 뒤 문항 번호를 하나씩 당겨 번호 연속성을 유지한다.
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
