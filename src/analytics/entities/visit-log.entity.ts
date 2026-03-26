import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('visit_logs')
@Index(['clientKey', 'viewedOn'], { unique: true })
export class VisitLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 128 })
  clientKey: string;

  @Column({ type: 'date' })
  viewedOn: string;

  @CreateDateColumn()
  createdAt: Date;
}
