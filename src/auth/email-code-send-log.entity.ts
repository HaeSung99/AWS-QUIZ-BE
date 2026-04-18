import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** 인증코드 발송 IP별 레이트 리밋 집계용 (SMTP 남용·스팸 방지) */
@Entity('email_code_send_logs')
@Index(['ip', 'createdAt'])
export class EmailCodeSendLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 128 })
  ip: string;

  @CreateDateColumn()
  createdAt: Date;
}
