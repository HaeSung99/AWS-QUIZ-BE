import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('workbook_attempts')
/** 사용자·문제집당 1행 = 최초 제출 점수만 저장, 재제출은 집계에 반영하지 않음 */
@Index(['userId', 'workbookId'], { unique: true })
export class WorkbookAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column({ length: 64 })
  workbookId: string;

  @Column({ type: 'int' })
  correctCount: number;

  @Column({ type: 'int' })
  totalCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
