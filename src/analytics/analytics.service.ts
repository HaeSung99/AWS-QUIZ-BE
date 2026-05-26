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
import { In, IsNull, Not, Repository } from 'typeorm';
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

  /**
   * [프론트] POST /public/track-visit 에서 호출됨(body: clientKey, eventType, isLoggedIn 등)
   * -> 방문 테이블(visit_logs)에서 동일 클라이언트·KST 오늘 날짜 행 존재 여부 검색
   * -> 이벤트(page_view/dwell 등)를 누적하고 봇/인간(visitorType) 판별 후 저장
   * -> 반환: { tracked, visitorType } 로 프론트 track-visit 응답에 사용됨.
   */
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

  /**
   * [프론트] POST /auth/me/workbook-attempts(Auth 제외 admin) 에서 호출됨
   * (포함 데이터: workbookId 선택, 문항별 questionAttempts[] — 선택 보기·정답 문자열·정오·카테고리 등)
   * -> 검색 question_attempts: userId(+선택 workbookId)로 모든 제출 회차별 문항 단위 행 저장
   * -> 검색 workbook_attempts: userId + workbookId 기준 최초 1건 없을 때만 correctCount/totalCount 저장, 이후 재제출은 스킵
   * -> 제공: 학습통계/Aggregate는 별도 도메인 호출하지만 저장 데이터가 통합분석·홈 문제집 통계 재료가 됨
   */
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

  /**
   * [보조함수] 이미 같은 user/workbook 에 대해 불러온 question_attempts 배열만 받음(API 직연결 없음).
   * -> 검색 없음. id 순으로 정렬 후 createdAt(ms)이 바뀌는 구간마다 새 “제출 1회” 버킷으로 분리
   * -> 제공: getMyLearningStats의 sessionCount, getWorkbookReviewSessions의 회차 분할에 재사용
   */
  private bucketQuestionAttemptsBySubmission(
    attempts: QuestionAttempt[],
  ): QuestionAttempt[][] {
    const sorted = [...attempts].sort((a, b) => a.id - b.id);
    const buckets: QuestionAttempt[][] = [];
    let current: QuestionAttempt[] = [];
    let lastTs: number | undefined;
    for (const row of sorted) {
      const ts = row.createdAt?.getTime() ?? 0;
      if (current.length > 0 && lastTs !== undefined && ts !== lastTs) {
        buckets.push(current);
        current = [];
      }
      current.push(row);
      lastTs = ts;
    }
    if (current.length > 0) buckets.push(current);
    return buckets;
  }

  /**
   * [프론트] GET /auth/me/learning-stats (Jwt userId 파라미터로 전달됨).
   * -> 검색 question_attempts 에서 해당 userId 전체 카운트·정답 합계 - 통합 정답률(카테고리/추천 문항 포함)
   * -> 검색 workbook_attempts 에서 userId별 행 목록 - 문제집별 최초 제출 점수(정답률 표시용)
   * -> 검색 Mongo questions (_id workbookId 매칭) 로 문제집 제목
   * -> 검색 question_attempts 중 workbookId not null 에 대해 버킷 수 - 같은 문제집 제출 회차(sessionCount)
   * -> 제공: 프론트에 { overall:{ totalCount, correctCount, accuracy }, workbooks:[…] }
   */
  async getMyLearningStats(userId: number) {
    const overallAgg = await this.questionAttemptRepository
      .createQueryBuilder('qa')
      .select('COUNT(*)', 'total')
      .addSelect(
        `SUM(CASE WHEN qa.isCorrect = true THEN 1 ELSE 0 END)`,
        'correct',
      )
      .where('qa.userId = :userId', { userId })
      .getRawOne<{ total: string; correct: string | null }>();

    const totalQuestions = Number(overallAgg?.total ?? 0);
    const overallCorrect = Number(overallAgg?.correct ?? 0);
    const overallAccuracy =
      totalQuestions > 0
        ? Number(((overallCorrect / totalQuestions) * 100).toFixed(1))
        : null;

    const workbookRows = await this.workbookAttemptRepository.find({
      where: { userId },
      order: { workbookId: 'ASC' },
    });

    const workbookIds = workbookRows.map((r) => r.workbookId).filter(Boolean);
    const workbookQuestionTitles = workbookIds.length
      ? await this.questionModel
          .find({ _id: { $in: workbookIds.map((id) => new Types.ObjectId(id)) } })
          .select({ _id: 1, title: 1 })
          .lean()
          .exec()
      : [];
    const titleMap = new Map(
      workbookQuestionTitles.map((q) => [String(q._id), q.title as string]),
    );

    const sessionShells = await this.questionAttemptRepository.find({
      where: { userId, workbookId: Not(IsNull()) },
      select: {
        id: true,
        workbookId: true,
        createdAt: true,
      },
      order: { id: 'ASC' },
    });
    const byWorkbookSessions = new Map<string, QuestionAttempt[]>();
    for (const shell of sessionShells) {
      const wid = shell.workbookId!;
      const list = byWorkbookSessions.get(wid) ?? [];
      list.push(shell as QuestionAttempt);
      byWorkbookSessions.set(wid, list);
    }
    const sessionCountMap = new Map<string, number>();
    for (const [wid, list] of byWorkbookSessions) {
      sessionCountMap.set(
        wid,
        this.bucketQuestionAttemptsBySubmission(list).length,
      );
    }

    const workbooks = workbookRows.map((row) => {
      const pct =
        row.totalCount > 0
          ? Number(((row.correctCount / row.totalCount) * 100).toFixed(1))
          : 0;
      return {
        workbookId: row.workbookId,
        title: titleMap.get(row.workbookId) ?? row.workbookId,
        accuracy: pct,
        correctCount: row.correctCount,
        totalCount: row.totalCount,
        sessionCount: sessionCountMap.get(row.workbookId) ?? 0,
      };
    });

    return {
      overall: {
        totalCount: totalQuestions,
        correctCount: overallCorrect,
        accuracy:
          overallAccuracy === null ? null : (overallAccuracy as number),
      },
      workbooks,
    };
  }

  /**
   * [프론트] GET /auth/me/workbooks/:workbookId/review 경로 매개변수 workbookId(+Jwt userId).
   * -> 검색 question_attempts 에서 userId + workbookId 전체 행 시간순 저장분
   * -> 검색 Mongo questions 로 문제집 제목, Mongo question_items 로 문항 본문·선택지·번호·카테고리
   * -> 제공: 회차별(sessions 최신먼저) 각 문항에 대해 선택답·정답 보기 문자열·정오·스템 요약 포함 JSON
   */
  async getWorkbookReviewSessions(userId: number, workbookId: string) {
    const trimmed = workbookId.trim();
    if (!trimmed) return { workbookId: '', title: '', sessions: [] };

    const attempts = await this.questionAttemptRepository.find({
      where: { userId, workbookId: trimmed },
      order: { id: 'ASC' },
    });
    if (attempts.length === 0) {
      return { workbookId: trimmed, title: '', sessions: [] };
    }

    const workbookDoc = await this.questionModel
      .findById(trimmed)
      .select({ title: 1 })
      .lean()
      .exec();
    const workbookTitle =
      workbookDoc &&
      typeof (workbookDoc as { title?: string }).title === 'string'
        ? (workbookDoc as { title: string }).title
        : '';

    const buckets = this.bucketQuestionAttemptsBySubmission(attempts);
    const descending = buckets.slice().reverse();

    const allQuestionIds = [
      ...new Set(attempts.map((a) => a.questionId).filter(Boolean)),
    ];
    const objectIds = allQuestionIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    const mongoItems =
      objectIds.length > 0
        ? await this.questionItemModel
            .find({ _id: { $in: objectIds } })
            .select({
              questionDescription: 1,
              choices: 1,
              questionNumber: 1,
              difficulty: 1,
              questionCategory: 1,
            })
            .lean()
            .exec()
        : [];
    const itemMap = new Map(
      mongoItems.map((doc) => {
        const d = doc as {
          _id: Types.ObjectId;
          questionDescription?: string;
          choices?: string[];
          questionNumber?: number;
          difficulty?: string;
          questionCategory?: string;
        };
        return [
          String(d._id),
          {
            questionNumber: d.questionNumber ?? 0,
            questionDescription: d.questionDescription ?? '',
            choices: Array.isArray(d.choices) ? d.choices : [],
            difficulty: d.difficulty ?? '',
            questionCategory: d.questionCategory ?? '',
          },
        ];
      }),
    );

    const sessions = descending.map((batch) => {
      const submittedAt =
        batch[0]?.createdAt?.toISOString() ?? new Date().toISOString();
      let correctCt = 0;
      const items = batch.map((attempt) => {
        const meta = itemMap.get(attempt.questionId) ?? null;
        if (attempt.isCorrect) correctCt += 1;
        return {
          questionId: attempt.questionId,
          questionNumber: meta?.questionNumber ?? 0,
          questionDescription: meta?.questionDescription ?? '',
          choices: meta?.choices ?? [],
          difficulty: meta?.difficulty ?? attempt.difficulty,
          questionCategory: meta?.questionCategory ?? attempt.questionCategory,
          selectedAnswer: attempt.selectedAnswer,
          correctAnswer: attempt.correctAnswer,
          isCorrect: attempt.isCorrect,
        };
      });
      const tc = batch.length;
      const acc = tc > 0 ? Number(((correctCt / tc) * 100).toFixed(1)) : 0;
      return {
        submittedAt,
        accuracy: acc,
        correctCount: correctCt,
        totalCount: tc,
        items,
      };
    });

    return {
      workbookId: trimmed,
      title: workbookTitle,
      sessions,
    };
  }

  /**
   * [보조] 약점 추천·오늘의 문제·임베딩 후보 만들 때 재사용(컨트롤러 노출 안 함).
   * -> 검색 Mongo questions 상태≠draft 및 선택 시 certificationType 일치 하는 문제집 _id 들
   * -> 검색 Mongo question_items questionId 로 전체 게시 문항 문서 목록 반환
   * -> 제공: 다른 메서드가 이 문항 배열에서 임베딩/유사도/랜덤 추출을 수행
   */
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

  /**
   * [보조] 문항별 embedding 테이블(question_embeddings)을 동기화. 직호출 거의 없고 sync* 경유.
   * -> 검색 question_embeddings 해당 questionIds 기존 행 및 Mongo questions 로 자격증 타입 매핑
   * -> OpenAI 임베딩 재계산 후 contentHash 변경 시 업데이트
   * -> 제공: 반환 행 객체를 getRecommendedQuestions 등이 코사인 유사도 계산할 때 재사용
   */
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
   * [백오피스/내부] 문제집(Mongo 문제집 _id 문자열 워크북 단위 전체 문항 재임베딩 필요 시).
   * -> 검색 Mongo question_items questionId 로 모든 문항
   * -> ensureQuestionEmbeddings 일괄 호출 결과 DB 반영
   */
  async syncQuestionEmbeddingsForWorkbook(workbookMongoId: string): Promise<void> {
    const items = await this.questionItemModel
      .find({ questionId: new Types.ObjectId(workbookMongoId) })
      .sort({ questionNumber: 1 })
      .exec();
    await this.ensureQuestionEmbeddings(items);
  }

  /**
   * [백오피스/내부] 단일 문항 저장 직후 임베딩만 업데이트할 때 호출됨(admin 파이프라인 등).
   * -> 검색/제공 로직 동일 하나의 아이템만 ensureQuestionEmbeddings 로 전달
   */
  async syncQuestionEmbeddingForItem(item: QuestionItemDocument): Promise<void> {
    await this.ensureQuestionEmbeddings([item]);
  }

  /**
   * [프론트] GET /auth/me/recommended-questions(limit, 사용자 목표 자격증 선택 시 필터 포함).
   * -> 검색 question_attempts 최근 DESC 50건·userId (불충족 시 BadRequest, 전체 정답이면 빈 배열)
   * -> 검색 getPublishedQuestionItems 목표 자격증 기준 문항 + ensureQuestionEmbeddings 로 벡터
   * -> 검색 question_embeddings 풀이에 등장한 questionId 들의 임베딩(공개 목록 외 과거 문제도 포함) 병합
   * -> 약점 벡터: 오답은 임베딩 더함·정답은 소폭 뺌, 시간감쇠 후 게시 문항 임베딩과 유사도+페널티로 정렬
   * -> 제공: 퀴즈 화면용 문제 배열(similarity, 추천 사유 문자열 포함)
   */
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

  /**
   * [프론트] GET /auth/me/daily-questions (필요: 사용자 목표 자격증 문자열 파라미터).
   * -> 검색 getPublishedQuestionItems(certificationType) 로 후보 문제집 전체 게시 문항
   * -> 날짜+user+certification+문항id 해시 시드 정렬 후 limit 자름(하루 동안 동일 순서 의도).
   * -> 제공: 랜덤 추천 사유 문자열 포함 일반 문제 JSON 배열(OpenAI 호출 없음).
   */
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

  /**
   * [프론트] GET /auth/me/weakness-comment(Jwt).
   * -> 검색 question_attempts 최근 50건 userId 분량 부족 시 안내 문자열만 반환 ready=false
   * -> 유형(questionCategory)별 오답/정답 요약 만들고 getRecommendedQuestions(5건) 결과와 결합해 프롬프트 구성
   * -> 검색 user_weakness_comments 해당 user + KST 날짜 동일 행이 있으면 오늘 캐시로 즉시 반환
   * -> 없으면 OpenAI 채팅 한 번 호출 후 캐시 저장·하루 1회 생성 제한 목적으로 comment 제공.
   */
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

  /**
   * [보조] 위 약점 쿼리 raw row 를 DTO 형태(total/correct/wrong/wrongRate)로 변환(API 직통 없음).
   */
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

  /**
   * [프론트] GET /auth/me/weak-categories(limit, Jwt userId).
   * -> 검색 question_attempts SQL GROUP BY questionCategory 해당 사용자만 필터링
   * -> 제공: 카테고리별 total/correct/wrong/wrongRate 정렬 목록(홈 “내 자주 틀리는 유형” 카드 등).
   */
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

  /**
   * [프론트] GET /auth/weak-categories/global (인증 Jwt 필요하지만 userId 무관 전역 집계).
   * -> 검색 question_attempts 전 사용자 전체(questionCategory별 aggregate)
   * -> 제공: 전체 학습 트렌드용 카테고리 오답률 순 테이블(개인값 혼합 아님).
   */
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

  /**
   * [관리 보조·getAdminOverview 전용일 뿐] 일/월 단위 회원 가입 추이(users) 및 방문 visit_logs 집계.
   * -> users.createdAt 또는 visit_logs.viewedOn KST 문자열 단위 그룹
   * -> 제공: 일별 가입건수, 월별 가입건수, 일별 방문(전체·human·bot·unknown) 시계열.
   */
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
    const safeDays = Math.max(1, days);
    const todayYmd = this.dateString();
    const minViewedOn = this.subtractCalendarDaysFromYmd(
      todayYmd,
      safeDays - 1,
    );
    const dateExpr = "DATE_FORMAT(v.viewedOn, '%Y-%m-%d')";
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
      .where('v.viewedOn >= :minViewedOn', { minViewedOn })
      .andWhere('v.viewedOn <= :maxViewedOn', { maxViewedOn: todayYmd })
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
    const monthExpr = "DATE_FORMAT(v.viewedOn, '%Y-%m')";
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

  /**
   * [프론트] GET /public/workbooks/accuracy (관리자 대시보드에서는 동일 함수에 limit 으로 상위만 조회 가능).
   * -> 검색 workbook_attempts + users inner join 역할 user 일반만 집계(관리자 제출 제외)
   * -> Mongo questions 상태 published 인 문제집만 남김 후 workbookId별 정답 합/total합/참여인원 카운트
   * -> 제공: 홈 문제집 목록에 쓰이는 문제집 제목·전체 참여 평균 정답률·participant 수 배열 JSON.
   */
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

  /**
   * [프론트/관리] GET /admin/stats/overview 등에서 사용, 컨트롤러가 이 서비스 함수 조합.
   * -> users 총원, visit_logs 오늘 KST 방문 수, getWorkbookAccuracy(10) 상위 문제집 통계
   * -> buildDaily/Monthly* 로 가입·방문 시계열 보조데이터 수집
   * -> 제공: 대시보드 한 화면에 필요한 요약 JSON 묶음.
   */
  async getAdminOverview() {
    const totalUsers = await this.usersRepository.count();
    const today = this.dateString();
    const todayVisitors = await this.visitLogRepository
      .createQueryBuilder('v')
      .where('v.viewedOn = :today', { today })
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
