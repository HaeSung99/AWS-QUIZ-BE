import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { TrackVisitDto } from './dto/track-visit.dto';
import { VisitLog } from './entities/visit-log.entity';
import { WorkbookAttempt } from './entities/workbook-attempt.entity';
import { Question, QuestionDocument } from '../admin/schemas/question.schema';

type VisitorType = 'human' | 'bot' | 'unknown';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(VisitLog)
    private readonly visitLogRepository: Repository<VisitLog>,
    @InjectRepository(WorkbookAttempt)
    private readonly workbookAttemptRepository: Repository<WorkbookAttempt>,
    @InjectModel(Question.name)
    private readonly questionModel: Model<QuestionDocument>,
  ) {}

  private dateString(date = new Date()) {
    return date.toISOString().slice(0, 10);
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
    workbookId: string;
    correctCount: number;
    totalCount: number;
  }) {
    const workbookId = input.workbookId.trim();
    const totalCount = input.totalCount;
    const correctCount = input.correctCount;

    const existing = await this.workbookAttemptRepository.findOne({
      where: { userId: input.userId, workbookId },
    });

    if (totalCount <= 0) {
      return { saved: false };
    }

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

  private async buildDailyUserSignups(days = 30) {
    const rows = await this.usersRepository
      .createQueryBuilder('u')
      .select("DATE_FORMAT(u.createdAt, '%Y-%m-%d')", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('u.createdAt >= DATE_SUB(CURDATE(), INTERVAL :days DAY)', { days })
      .groupBy("DATE_FORMAT(u.createdAt, '%Y-%m-%d')")
      .orderBy("DATE_FORMAT(u.createdAt, '%Y-%m-%d')", 'ASC')
      .getRawMany<{ date: string; count: string }>();

    return rows.map((row) => ({ date: row.date, count: Number(row.count) }));
  }

  private async buildMonthlyUserSignups(months = 12) {
    const rows = await this.usersRepository
      .createQueryBuilder('u')
      .select("DATE_FORMAT(u.createdAt, '%Y-%m')", 'month')
      .addSelect('COUNT(*)', 'count')
      .where('u.createdAt >= DATE_SUB(CURDATE(), INTERVAL :months MONTH)', { months })
      .groupBy("DATE_FORMAT(u.createdAt, '%Y-%m')")
      .orderBy("DATE_FORMAT(u.createdAt, '%Y-%m')", 'ASC')
      .getRawMany<{ month: string; count: string }>();

    return rows.map((row) => ({ month: row.month, count: Number(row.count) }));
  }

  private async buildDailyVisitors(days = 30) {
    const rows = await this.visitLogRepository
      .createQueryBuilder('v')
      .select('v.viewedOn', 'date')
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
      .where('v.viewedOn >= DATE_SUB(CURDATE(), INTERVAL :days DAY)', { days })
      .groupBy('v.viewedOn')
      .orderBy('v.viewedOn', 'ASC')
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
    const rows = await this.visitLogRepository
      .createQueryBuilder('v')
      .select("DATE_FORMAT(v.viewedOn, '%Y-%m')", 'month')
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
      .where('v.viewedOn >= DATE_SUB(CURDATE(), INTERVAL :months MONTH)', { months })
      .groupBy("DATE_FORMAT(v.viewedOn, '%Y-%m')")
      .orderBy("DATE_FORMAT(v.viewedOn, '%Y-%m')", 'ASC')
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
        const accuracy = total > 0 ? Number(((correct / total) * 100).toFixed(1)) : 0;
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
    const todayVisitors = await this.visitLogRepository.count({
      where: { viewedOn: today },
    });
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
