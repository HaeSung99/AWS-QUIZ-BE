import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('workbook_attempts')
/** 최초 제출 정책은 서비스 레이어에서 제어 */
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
