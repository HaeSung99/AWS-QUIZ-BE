import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import OpenAI from 'openai';
import { In, Repository } from 'typeorm';
import {
  QuestionItem,
  QuestionItemDocument,
} from '../admin/schemas/question-item.schema';
import { User } from '../users/user.entity';
import { TrackVisitDto } from './dto/track-visit.dto';
import { QuestionAttempt } from './entities/question-attempt.entity';
import { QuestionEmbedding } from './entities/question-embedding.entity';
import { UserWeaknessComment } from './entities/user-weakness-comment.entity';
import { VisitLog } from './entities/visit-log.entity';
import { WorkbookAttempt } from './entities/workbook-attempt.entity';
import { Question, QuestionDocument } from '../admin/schemas/question.schema';

type VisitorType = 'human' | 'bot' | 'unknown';

type RecommendedQuestion = {
  id: string;
  questionId: string;
  questionNumber: number;
  certificationType?: string | null;
  questionDescription: string;
  choices: string[];
  answer: string;
  hint: string;
  difficulty: string;
  questionCategory: string;
  similarity: number;
  recommendReason: string;
};

export const WEAKNESS_ANALYSIS_REQUIRED_ATTEMPTS = 50;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

@Injectable()
export class AnalyticsService {
  private openAIClient: OpenAI | null = null;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(VisitLog)
    private readonly visitLogRepository: Repository<VisitLog>,
    @InjectRepository(WorkbookAttempt)
    private readonly workbookAttemptRepository: Repository<WorkbookAttempt>,
    @InjectRepository(QuestionAttempt)
    private readonly questionAttemptRepository: Repository<QuestionAttempt>,
    @InjectRepository(QuestionEmbedding)
    private readonly questionEmbeddingRepository: Repository<QuestionEmbedding>,
    @InjectRepository(UserWeaknessComment)
    private readonly userWeaknessCommentRepository: Repository<UserWeaknessComment>,
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
    @InjectModel(QuestionItem.name)
    private readonly questionItemModel: Model<QuestionItemDocument>,
  ) {}

  private dateString(date = new Date()) {
    return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
  }

  /** YYYY-MM-DD 문자열에서 그레고리력으로 일수만큼 이전 날짜 */
  private subtractCalendarDaysFromYmd(ymd: string, deltaDays: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - deltaDays);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }

  /**
   * 일별 차트에 포함할 KST 달력 일수(days) 구간의 시작 시각.
   * 오늘(KST) 포함이므로 시작일은 오늘에서 (days - 1)일 전 자정(KST).
   */
  private kstMidnightCalendarInclusiveRangeStart(days: number): Date {
    const safeDays = Math.max(1, days);
    const firstYmd = this.subtractCalendarDaysFromYmd(
      this.dateString(),
      safeDays - 1,
    );
    return new Date(`${firstYmd}T00:00:00+09:00`);
  }

  /** 당월 포함 최근 months개월 월별 집계용 최소 YYYY-MM (KST 달력) */
  private kstMinYmRolling(months: number): string {
    const [ys, ms] = this.dateString().split('-');
    let y = Number(ys);
    let m = Number(ms) - (months - 1);
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    return `${y}-${String(m).padStart(2, '0')}`;
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

  private commentModel() {
    return (
      this.configService.get<string>('OPENAI_COMMENT_MODEL') ?? 'gpt-4o-mini'
    );
  }

  private normalizeQuestionText(item: QuestionItemDocument) {
    const choices = Array.isArray(item.choices) ? item.choices : [];
    return [
      `문제: ${item.questionDescription}`,
      `선택지: ${choices.map((choice, index) => `${index + 1}. ${choice}`).join(' / ')}`,
      `유형: ${item.questionCategory}`,
      `난이도: ${item.difficulty}`,
      `힌트: ${item.hint?.trim() || '없음'}`,
    ].join('\n');
  }

  private contentHash(content: string) {
    return createHash('sha256').update(content).digest('hex');
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

  private toRecommendedQuestion(
    item: QuestionItemDocument,
    similarity: number,
    recommendReason: string,
    questionNumber: number,
    certificationType: string | null = null,
  ): RecommendedQuestion {
    return {
      id: item._id.toString(),
      questionId: item.questionId.toString(),
      questionNumber,
      certificationType,
      questionDescription: item.questionDescription,
      choices: item.choices,
      answer: item.answer,
      hint: item.hint ?? '',
      difficulty: item.difficulty,
      questionCategory: item.questionCategory,
      similarity: Number(similarity.toFixed(4)),
      recommendReason,
    };
  }

  private isBotUserAgent(userAgent?: string | null) {
    if (!userAgent) return false;
    return /bot|crawler|spider|googlebot|naverbot|bingbot|duckduckbot|baiduspider|yandexbot|facebookexternalhit|slurp/i.test(
      userAgent,
    );
  }

  private classifyVisit(visit: VisitLog): VisitorType {
    if (this.isBotUserAgent(visit.userAgent)) return 'bot';
    const humanSignalCount = [
      visit.hasDwell,
      visit.hasScroll,
      visit.hasClick,
      visit.hasSearchInput,
      visit.hasQuizEnter,
      visit.hasAnswerSelect,
      visit.hasQuizSubmit,
    ].filter(Boolean).length;
    if (visit.isLoggedIn || humanSignalCount >= 2) {
      return 'human';
    }
    return 'unknown';
  }

  private applyVisitEvent(visit: VisitLog, dto: TrackVisitDto) {
    if (dto.isLoggedIn) visit.isLoggedIn = true;
    switch (dto.eventType) {
      case 'dwell_5s':
        visit.hasDwell = true;
        break;
      case 'scroll':
        visit.hasScroll = true;
        break;
      case 'click':
        visit.hasClick = true;
        break;
      case 'search_input':
        visit.hasSearchInput = true;
        break;
      case 'quiz_enter':
        visit.hasQuizEnter = true;
        break;
      case 'answer_select':
        visit.hasAnswerSelect = true;
        break;
      case 'quiz_submit':
        visit.hasQuizSubmit = true;
        break;
      case 'login':
        visit.isLoggedIn = true;
        break;
      case 'page_view':
      default:
        break;
    }
  }

  async trackVisit(dto: TrackVisitDto, meta?: { userAgent?: string | null }) {
    const clientKey = dto.clientKey.trim();
    if (!clientKey) return { tracked: false };
    const viewedOn = this.dateString();

    const existing = await this.visitLogRepository.findOne({
      where: { clientKey, viewedOn },
    });
    if (existing) {
      if (!existing.userAgent && meta?.userAgent) {
        existing.userAgent = meta.userAgent.slice(0, 512);
      }
      this.applyVisitEvent(existing, dto);
      existing.visitorType = this.classifyVisit(existing);
      await this.visitLogRepository.save(existing);
      return { tracked: true, visitorType: existing.visitorType };
    }

    const created = this.visitLogRepository.create({
      clientKey,
      viewedOn,
      userAgent: meta?.userAgent ? meta.userAgent.slice(0, 512) : null,
    });
    this.applyVisitEvent(created, dto);
    created.visitorType = this.classifyVisit(created);
    await this.visitLogRepository.save(created);
    return { tracked: true, visitorType: created.visitorType };
  }

  async recordWorkbookAttempt(input: {
    userId: number;
    workbookId?: string;
    correctCount: number;
    totalCount: number;
    questionAttempts?: Array<{
      questionId: string;
      certificationType?: string | null;
      questionCategory: string;
      difficulty: string;
      selectedAnswer?: string | null;
      correctAnswer: string;
      isCorrect: boolean;
    }>;
  }) {
    const workbookId = input.workbookId?.trim() ?? '';
    const totalCount = input.totalCount;
    const correctCount = input.correctCount;

    if (totalCount <= 0) {
      return { saved: false };
    }

    const questionAttempts = (input.questionAttempts ?? []).map((item) =>
      this.questionAttemptRepository.create({
        userId: input.userId,
        workbookId: workbookId || null,
        certificationType: item.certificationType?.trim() || null,
        questionId: item.questionId.trim(),
        questionCategory: item.questionCategory.trim(),
        difficulty: item.difficulty.trim(),
        selectedAnswer: item.selectedAnswer ?? null,
        correctAnswer: item.correctAnswer,
        isCorrect: item.isCorrect,
      }),
    );

    if (questionAttempts.length > 0) {
      await this.questionAttemptRepository.save(questionAttempts);
    }

    if (!workbookId) {
      return { saved: true };
    }

    const existing = await this.workbookAttemptRepository.findOne({
      where: { userId: input.userId, workbookId },
    });

    if (!existing) {
      await this.workbookAttemptRepository.save(
        this.workbookAttemptRepository.create({
          userId: input.userId,
          workbookId,
          correctCount,
          totalCount,
        }),
      );
      return { saved: true };
    }

    // 재제출: 정답률 집계는 최초 제출 1건만 유지 (이후 제출은 DB에 반영하지 않음)
    return { saved: true };
  }

  private async getPublishedQuestionItems(certificationType?: string | null) {
    const questionFilter: { status: { $ne: 'draft' }; certificationType?: string } =
      { status: { $ne: 'draft' } };
    if (certificationType) {
      questionFilter.certificationType = certificationType;
    }

    const publishedQuestions = await this.questionModel
      .find(questionFilter)
      .select({ _id: 1 })
      .lean()
      .exec();
    const publishedQuestionIds = publishedQuestions.map(
      (question) => question._id,
    );
    if (publishedQuestionIds.length === 0) return [];

    return this.questionItemModel
      .find({ questionId: { $in: publishedQuestionIds } })
      .sort({ updatedAt: -1, questionNumber: 1 })
      .exec();
  }

  private async ensureQuestionEmbeddings(items: QuestionItemDocument[]) {
    if (items.length === 0) return [];

    const itemIds = items.map((item) => item._id.toString());
    const workbookIds = [...new Set(items.map((item) => item.questionId.toString()))];
    const workbookRows = await this.questionModel
      .find({ _id: { $in: workbookIds } })
      .select({ _id: 1, certificationType: 1 })
      .lean()
      .exec();
    const certificationMap = new Map(
      workbookRows.map((row) => [String(row._id), row.certificationType]),
    );
    const existingRows = await this.questionEmbeddingRepository.find({
      where: { questionId: In(itemIds) },
    });
    const existingMap = new Map(
      existingRows.map((row) => [row.questionId, row]),
    );
    const savedRows: QuestionEmbedding[] = [];

    for (const item of items) {
      const questionId = item._id.toString();
      const content = this.normalizeQuestionText(item);
      const contentHash = this.contentHash(content);
      const existing = existingMap.get(questionId);

      if (existing && existing.contentHash === contentHash) {
        savedRows.push(existing);
        continue;
      }

      const embedding = await this.createEmbedding(content);
      const row = existing ?? this.questionEmbeddingRepository.create();
      row.questionId = questionId;
      row.workbookId = item.questionId.toString();
      row.certificationType = certificationMap.get(item.questionId.toString()) ?? null;
      row.questionCategory = item.questionCategory;
      row.difficulty = item.difficulty;
      row.contentHash = contentHash;
      row.embedding = embedding;
      savedRows.push(await this.questionEmbeddingRepository.save(row));
    }

    return savedRows;
  }

  /**
   * 게시된 문제집의 모든 문항에 대해 임베딩을 생성하거나 본문이 바뀐 경우 갱신합니다.
   * draft 상태에서는 호출하지 않는 것을 권장합니다.
   */
  async syncQuestionEmbeddingsForWorkbook(workbookMongoId: string): Promise<void> {
    const items = await this.questionItemModel
      .find({ questionId: new Types.ObjectId(workbookMongoId) })
      .sort({ questionNumber: 1 })
      .exec();
    await this.ensureQuestionEmbeddings(items);
  }

  /** 게시 상태에서 특정 문항만 저장했을 때 해당 문항 임베딩만 동기화합니다. */
  async syncQuestionEmbeddingForItem(item: QuestionItemDocument): Promise<void> {
    await this.ensureQuestionEmbeddings([item]);
  }

  async getRecommendedQuestions(
    userId: number,
    limit = 20,
    targetCertificationType?: string | null,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);

    // 1. 최근 풀이 기록을 가져온다. 전체 누적이 아니라 현재 약점만 반영하기 위해 최근 50개만 본다.
    const attempts = await this.questionAttemptRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    if (attempts.length < WEAKNESS_ANALYSIS_REQUIRED_ATTEMPTS) {
      throw new BadRequestException(
        `약점 기반 유사 문제는 최근 ${WEAKNESS_ANALYSIS_REQUIRED_ATTEMPTS}문제 풀이 기록이 쌓인 뒤 제공됩니다.`,
      );
    }
    if (!attempts.some((attempt) => !attempt.isCorrect)) return [];

    // 2. 추천 후보가 될 published 문항과 embedding을 준비한다.
    const publishedItems = await this.getPublishedQuestionItems(
      targetCertificationType,
    );
    const publishedEmbeddings =
      await this.ensureQuestionEmbeddings(publishedItems);

    // 3. 사용자가 푼 문항의 embedding도 확보해서 현재 약점 벡터 계산에 사용한다.
    const attemptEmbeddings = await this.questionEmbeddingRepository.find({
      where: { questionId: In(attempts.map((attempt) => attempt.questionId)) },
    });
    const embeddingMap = new Map(
      [...publishedEmbeddings, ...attemptEmbeddings].map((row) => [
        row.questionId,
        row,
      ]),
    );

    // 4. 최근 풀이 기록으로 현재 약점 벡터를 만든다.
    // 오답은 약점 방향으로 더하고, 정답은 약점 완화 신호로 빼며, 오래된 기록은 영향력을 줄인다.
    const firstEmbedding = attempts
      .map((attempt) => embeddingMap.get(attempt.questionId)?.embedding)
      .find((embedding): embedding is number[] => Array.isArray(embedding));
    if (!firstEmbedding) return [];

    const now = Date.now();
    const weaknessVector = new Array(firstEmbedding.length).fill(0) as number[];
    let signalCount = 0;

    for (const attempt of attempts) {
      const embedding = embeddingMap.get(attempt.questionId)?.embedding;
      if (!embedding) continue;

      const elapsedDays = Math.max(
        0,
        (now - attempt.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      const timeWeight = Math.exp(-elapsedDays / 14);
      const resultWeight = attempt.isCorrect ? -0.35 : 1;
      const weight = timeWeight * resultWeight;

      for (let i = 0; i < weaknessVector.length; i += 1) {
        weaknessVector[i] += (embedding[i] ?? 0) * weight;
      }
      signalCount += 1;
    }

    const vectorMagnitude = Math.sqrt(
      weaknessVector.reduce((sum, value) => sum + value * value, 0),
    );
    if (signalCount === 0 || vectorMagnitude === 0) return [];

    // 5. 최근에 이미 맞힌 문항과 자주 본 문항은 추천 점수를 낮추기 위한 힌트를 만든다.
    const attemptCounts = new Map<string, number>();
    const recentlyCorrectIds = new Set<string>();
    const weaknessSummary = new Map<
      string,
      { wrong: number; correct: number }
    >();

    for (const attempt of attempts) {
      attemptCounts.set(
        attempt.questionId,
        (attemptCounts.get(attempt.questionId) ?? 0) + 1,
      );
      if (attempt.isCorrect) recentlyCorrectIds.add(attempt.questionId);

      const summary = weaknessSummary.get(attempt.questionCategory) ?? {
        wrong: 0,
        correct: 0,
      };
      if (attempt.isCorrect) summary.correct += 1;
      else summary.wrong += 1;
      weaknessSummary.set(attempt.questionCategory, summary);
    }

    // 6. 모든 published 문항을 현재 약점 벡터와 비교하고 추천 점수를 계산한다.
    const itemMap = new Map(
      publishedItems.map((item) => [item._id.toString(), item]),
    );
    const scored: Array<{
      item: QuestionItemDocument;
      score: number;
      baseSimilarity: number;
      certificationType: string | null;
    }> = [];

    for (const row of publishedEmbeddings) {
      const item = itemMap.get(row.questionId);
      if (!item) continue;
      const baseSimilarity = this.cosineSimilarity(
        weaknessVector,
        row.embedding,
      );
      const attemptedPenalty = Math.min(
        0.3,
        (attemptCounts.get(row.questionId) ?? 0) * 0.05,
      );
      const correctPenalty = recentlyCorrectIds.has(row.questionId) ? 0.25 : 0;
      const score = baseSimilarity - attemptedPenalty - correctPenalty;
      scored.push({
        item,
        score,
        baseSimilarity,
        certificationType: row.certificationType,
      });
    }

    // 7. 점수가 높은 순서대로 제한하고, 화면에서 바로 쓸 수 있는 응답 형태로 바꾼다.
    const recommendedRows = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, safeLimit);

    return recommendedRows.map((row, index) => {
      const categorySummary = weaknessSummary.get(row.item.questionCategory);
      const recommendReason =
        categorySummary && categorySummary.wrong > 0
          ? `최근 ${row.item.questionCategory} 유형 오답 패턴과 문제 스타일 유사도가 높습니다.`
          : row.baseSimilarity >= 0.7
            ? '최근 오답 문제와 표현 방식과 풀이 흐름이 유사합니다.'
            : '최근 풀이 기록에서 남아있는 약점 벡터와 유사합니다.';

      return this.toRecommendedQuestion(
        row.item,
        row.baseSimilarity,
        recommendReason,
        index + 1,
        row.certificationType,
      );
    });
  }

  async getDailyQuestions(
    userId: number,
    targetCertificationType: string,
    limit = 5,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 20);

    // 1. 오늘의 문제는 사용자의 목표 자격증 안에서만 제공한다.
    const publishedItems = await this.getPublishedQuestionItems(
      targetCertificationType,
    );
    if (publishedItems.length === 0) return [];

    // 2. KST 날짜, 사용자, 목표 자격증을 seed로 사용해 하루 동안 같은 랜덤 순서를 유지한다.
    const today = this.dateString();
    const seededItems = publishedItems
      .map((item) => {
        const seed = `${today}:${userId}:${targetCertificationType}:${item._id.toString()}`;
        const score = parseInt(this.contentHash(seed).slice(0, 12), 16);
        return { item, score };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, safeLimit);

    // 3. 퀴즈 화면에서 바로 풀 수 있는 형태로 반환한다.
    return seededItems.map((row, index) =>
      this.toRecommendedQuestion(
        row.item,
        0,
        `${targetCertificationType} 오늘의 랜덤 문제입니다.`,
        index + 1,
        targetCertificationType,
      ),
    );
  }

  async getWeaknessComment(userId: number) {
    // 1. AI 코멘트도 현재 상태를 말해야 하므로 최근 풀이 기록만 본다.
    const attempts = await this.questionAttemptRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    if (attempts.length === 0) {
      return {
        comment:
          '아직 풀이 기록이 부족합니다. 몇 문제를 풀고 나면 약점 분석을 제공할 수 있습니다.',
        attemptCount: 0,
        requiredAttemptCount: WEAKNESS_ANALYSIS_REQUIRED_ATTEMPTS,
        remainingAttemptCount: WEAKNESS_ANALYSIS_REQUIRED_ATTEMPTS,
        ready: false,
      };
    }

    const attemptCount = attempts.length;
    const remainingAttemptCount = Math.max(
      WEAKNESS_ANALYSIS_REQUIRED_ATTEMPTS - attemptCount,
      0,
    );

    // 2. AI 약점 코멘트와 추천 연동은 최근 N문제 기록이 채워진 뒤에만 수행한다.
    if (attemptCount < WEAKNESS_ANALYSIS_REQUIRED_ATTEMPTS) {
      return {
        comment: '',
        attemptCount,
        requiredAttemptCount: WEAKNESS_ANALYSIS_REQUIRED_ATTEMPTS,
        remainingAttemptCount,
        ready: false,
      };
    }

    // 3. 최근 기록을 유형별 오답/정답 요약으로 바꾼다. 정답 수는 개선 중인 영역을 말하기 위한 신호다.
    const summaryMap = new Map<
      string,
      { wrong: number; correct: number; latestAt: string | null }
    >();
    for (const attempt of attempts) {
      const summary = summaryMap.get(attempt.questionCategory) ?? {
        wrong: 0,
        correct: 0,
        latestAt: null,
      };
      if (attempt.isCorrect) summary.correct += 1;
      else summary.wrong += 1;
      if (
        !summary.latestAt ||
        attempt.createdAt.toISOString() > summary.latestAt
      ) {
        summary.latestAt = attempt.createdAt.toISOString();
      }
      summaryMap.set(attempt.questionCategory, summary);
    }
    const weaknessSummary = [...summaryMap.entries()]
      .map(([category, summary]) => ({ category, ...summary }))
      .sort((a, b) => b.wrong - a.wrong || b.correct - a.correct)
      .slice(0, 6);

    // 4. 실제 추천 결과의 공통 특징도 같이 넣어 코멘트가 추천 문제와 따로 놀지 않게 한다.
    const recommendations = await this.getRecommendedQuestions(userId, 5);

    // 5. 같은 날 이미 생성한 코멘트가 있으면 저장된 값을 반환해서 하루 1회만 OpenAI 토큰을 쓴다.
    const commentDate = this.dateString();
    const recommendationSummary = recommendations.map((item) => ({
      category: item.questionCategory,
      difficulty: item.difficulty,
      reason: item.recommendReason,
    }));
    const commentInput = JSON.stringify({
      weaknessSummary,
      recommendations: recommendationSummary,
    });
    const inputHash = this.contentHash(commentInput);
    const cached = await this.userWeaknessCommentRepository.findOne({
      where: { userId, commentDate },
    });
    if (cached) {
      return {
        comment: cached.comment,
        attemptCount,
        requiredAttemptCount: WEAKNESS_ANALYSIS_REQUIRED_ATTEMPTS,
        remainingAttemptCount,
        ready: remainingAttemptCount === 0,
        cached: true,
      };
    }

    // 6. 민감한 사용자 정보 없이 학습 패턴 요약만 OpenAI에 보낸다.
    const prompt = [
      'AWS 자격증 퀴즈 학습자의 최근 풀이 기록을 보고 2문장 이내 한국어 코멘트를 작성하세요.',
      '단정적인 표현보다 학습 조언처럼 말하세요.',
      '최근 정답으로 개선되는 영역이 있으면 함께 언급하세요.',
      `최근 유형 요약: ${JSON.stringify(weaknessSummary)}`,
      `추천 문제 공통 특징: ${JSON.stringify(recommendationSummary)}`,
    ].join('\n');

    // 7. OpenAI 코멘트 생성 결과를 하루 캐시에 저장하고 홈 화면용 응답으로 반환한다.
    const response = await this.getOpenAIClient().chat.completions.create({
      model: this.commentModel(),
      messages: [
        {
          role: 'system',
          content:
            '너는 AWS 자격증 퀴즈 학습을 돕는 한국어 튜터다. 사용자의 약점과 개선 흐름을 짧고 구체적으로 말한다.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 180,
    });
    const comment =
      response.choices[0]?.message?.content?.trim() ??
      '최근 풀이 기록을 기준으로 약점 분석을 생성하지 못했습니다.';

    const cacheRow =
      cached ??
      this.userWeaknessCommentRepository.create({
        userId,
        commentDate,
      });
    cacheRow.inputHash = inputHash;
    cacheRow.comment = comment;
    await this.userWeaknessCommentRepository.save(cacheRow);

    return {
      comment,
      attemptCount,
      requiredAttemptCount: WEAKNESS_ANALYSIS_REQUIRED_ATTEMPTS,
      remainingAttemptCount,
      ready: remainingAttemptCount === 0,
      cached: false,
    };
  }

  private mapWeakCategoryRows(
    rows: Array<{
      category: string;
      total: string;
      wrong: string | null;
    }>,
  ) {
    return rows.map((row) => {
      const total = Number(row.total);
      const wrong = Number(row.wrong ?? 0);
      const correct = total - wrong;
      const wrongRate =
        total > 0 ? Number(((wrong / total) * 100).toFixed(1)) : 0;
      return {
        category: row.category,
        totalCount: total,
        correctCount: correct,
        wrongCount: wrong,
        wrongRate,
      };
    });
  }

  async getPersonalWeakCategories(userId: number, limit = 5) {
    const rows = await this.questionAttemptRepository
      .createQueryBuilder('qa')
      .select('qa.questionCategory', 'category')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        'SUM(CASE WHEN qa.isCorrect = false THEN 1 ELSE 0 END)',
        'wrong',
      )
      .addSelect(
        '(SUM(CASE WHEN qa.isCorrect = false THEN 1 ELSE 0 END) / COUNT(*))',
        'wrongRate',
      )
      .where('qa.userId = :userId', { userId })
      .groupBy('qa.questionCategory')
      .orderBy('wrongRate', 'DESC')
      .addOrderBy('wrong', 'DESC')
      .addOrderBy('total', 'DESC')
      .limit(limit)
      .getRawMany<{ category: string; total: string; wrong: string | null }>();

    return this.mapWeakCategoryRows(rows);
  }

  async getGlobalWeakCategories(limit = 5) {
    const rows = await this.questionAttemptRepository
      .createQueryBuilder('qa')
      .select('qa.questionCategory', 'category')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        'SUM(CASE WHEN qa.isCorrect = false THEN 1 ELSE 0 END)',
        'wrong',
      )
      .addSelect(
        '(SUM(CASE WHEN qa.isCorrect = false THEN 1 ELSE 0 END) / COUNT(*))',
        'wrongRate',
      )
      .groupBy('qa.questionCategory')
      .orderBy('wrongRate', 'DESC')
      .addOrderBy('wrong', 'DESC')
      .addOrderBy('total', 'DESC')
      .limit(limit)
      .getRawMany<{ category: string; total: string; wrong: string | null }>();

    return this.mapWeakCategoryRows(rows);
  }

  private async buildDailyUserSignups(days = 30) {
    const since = this.kstMidnightCalendarInclusiveRangeStart(days);
    const dateExpr = "DATE_FORMAT(u.createdAt, '%Y-%m-%d')";
    const rows = await this.usersRepository
      .createQueryBuilder('u')
      .select(dateExpr, 'date')
      .addSelect('COUNT(*)', 'count')
      .where('u.createdAt >= :since', { since })
      .groupBy(dateExpr)
      .orderBy(dateExpr, 'ASC')
      .getRawMany<{ date: string; count: string }>();

    return rows.map((row) => ({ date: row.date, count: Number(row.count) }));
  }

  private async buildMonthlyUserSignups(months = 12) {
    const minYm = this.kstMinYmRolling(months);
    const monthExpr = "DATE_FORMAT(u.createdAt, '%Y-%m')";
    const rows = await this.usersRepository
      .createQueryBuilder('u')
      .select(monthExpr, 'month')
      .addSelect('COUNT(*)', 'count')
      .where(`${monthExpr} >= :minYm`, { minYm })
      .groupBy(monthExpr)
      .orderBy(monthExpr, 'ASC')
      .getRawMany<{ month: string; count: string }>();

    return rows.map((row) => ({ month: row.month, count: Number(row.count) }));
  }

  private async buildDailyVisitors(days = 30) {
    const since = this.kstMidnightCalendarInclusiveRangeStart(days);
    const dateExpr = "DATE_FORMAT(v.createdAt, '%Y-%m-%d')";
    const rows = await this.visitLogRepository
      .createQueryBuilder('v')
      .select(dateExpr, 'date')
      .addSelect('COUNT(*)', 'count')
      .addSelect(
        "SUM(CASE WHEN v.visitorType = 'human' THEN 1 ELSE 0 END)",
        'human',
      )
      .addSelect(
        "SUM(CASE WHEN v.visitorType = 'bot' THEN 1 ELSE 0 END)",
        'bot',
      )
      .addSelect(
        "SUM(CASE WHEN v.visitorType IS NULL OR v.visitorType = 'unknown' THEN 1 ELSE 0 END)",
        'unknown',
      )
      .where('v.createdAt >= :since', { since })
      .groupBy(dateExpr)
      .orderBy(dateExpr, 'ASC')
      .getRawMany<{
        date: string;
        count: string;
        human: string | null;
        bot: string | null;
        unknown: string | null;
      }>();

    return rows.map((row) => ({
      date: row.date,
      count: Number(row.count),
      human: Number(row.human ?? 0),
      bot: Number(row.bot ?? 0),
      unknown: Number(row.unknown ?? 0),
    }));
  }

  private async buildMonthlyVisitors(months = 12) {
    const minYm = this.kstMinYmRolling(months);
    const monthExpr = "DATE_FORMAT(v.createdAt, '%Y-%m')";
    const rows = await this.visitLogRepository
      .createQueryBuilder('v')
      .select(monthExpr, 'month')
      .addSelect('COUNT(*)', 'count')
      .addSelect(
        "SUM(CASE WHEN v.visitorType = 'human' THEN 1 ELSE 0 END)",
        'human',
      )
      .addSelect(
        "SUM(CASE WHEN v.visitorType = 'bot' THEN 1 ELSE 0 END)",
        'bot',
      )
      .addSelect(
        "SUM(CASE WHEN v.visitorType IS NULL OR v.visitorType = 'unknown' THEN 1 ELSE 0 END)",
        'unknown',
      )
      .where(`${monthExpr} >= :minYm`, { minYm })
      .groupBy(monthExpr)
      .orderBy(monthExpr, 'ASC')
      .getRawMany<{
        month: string;
        count: string;
        human: string | null;
        bot: string | null;
        unknown: string | null;
      }>();

    return rows.map((row) => ({
      month: row.month,
      count: Number(row.count),
      human: Number(row.human ?? 0),
      bot: Number(row.bot ?? 0),
      unknown: Number(row.unknown ?? 0),
    }));
  }

  async getWorkbookAccuracy(limit?: number) {
    const query = this.workbookAttemptRepository
      .createQueryBuilder('a')
      .innerJoin(User, 'u', 'u.id = a.userId')
      .where('u.role = :userRole', { userRole: 'user' })
      .select('a.workbookId', 'workbookId')
      .addSelect('SUM(a.correctCount)', 'correctSum')
      .addSelect('SUM(a.totalCount)', 'totalSum')
      .addSelect('COUNT(*)', 'attemptCount')
      .groupBy('a.workbookId')
      .orderBy('attemptCount', 'DESC');

    if (typeof limit === 'number' && limit > 0) {
      query.limit(limit);
    }

    const rows = await query.getRawMany<{
      workbookId: string;
      correctSum: string;
      totalSum: string;
      attemptCount: string;
    }>();

    const workbookIds = rows.map((row) => row.workbookId);
    const questions = workbookIds.length
      ? await this.questionModel
          .find({ _id: { $in: workbookIds } })
          .select({ _id: 1, title: 1, status: 1 })
          .lean()
          .exec()
      : [];

    const titleMap = new Map<string, string>();
    const publishedIds = new Set<string>();
    for (const question of questions) {
      const id = String(question._id);
      titleMap.set(id, question.title);
      const st = (question as { status?: string }).status;
      if (st !== 'draft') {
        publishedIds.add(id);
      }
    }

    return rows
      .filter((row) => publishedIds.has(row.workbookId))
      .map((row) => {
        const correct = Number(row.correctSum);
        const total = Number(row.totalSum);
        const accuracy =
          total > 0 ? Number(((correct / total) * 100).toFixed(1)) : 0;
        return {
          workbookId: row.workbookId,
          title: titleMap.get(row.workbookId) ?? row.workbookId,
          accuracy,
          attemptCount: Number(row.attemptCount),
        };
      });
  }

  async getAdminOverview() {
    const totalUsers = await this.usersRepository.count();
    const today = this.dateString();
    const todayVisitors = await this.visitLogRepository
      .createQueryBuilder('v')
      .where("DATE_FORMAT(v.createdAt, '%Y-%m-%d') = :today", { today })
      .getCount();
    const workbookAccuracy = await this.getWorkbookAccuracy(10);

    return {
      totalUsers,
      todayVisitors,
      dailySignups: await this.buildDailyUserSignups(30),
      monthlySignups: await this.buildMonthlyUserSignups(12),
      dailyVisitors: await this.buildDailyVisitors(30),
      monthlyVisitors: await this.buildMonthlyVisitors(12),
      workbookAccuracy,
    };
  }
}
