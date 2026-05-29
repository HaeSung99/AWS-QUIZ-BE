import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 255 })
  email: string;

  @Column({ length: 100 })
  name: string;

  @Column({ select: false })
  password: string;

  @Column({
    type: 'enum',
    enum: ['user', 'admin'],
    default: 'user',
  })
  role: 'user' | 'admin';

  @Column({ type: 'simple-json', nullable: true })
  solvedWorkbookIds: string[];

  @Column({ type: 'varchar', length: 20, nullable: true })
  targetCertificationType: string | null;

  /** bcrypt 해시 — 클라이언트가 보낸 refreshToken 원문과 compare로 세션 검증 */
  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  refreshToken: string | null;

  @Column({ type: 'datetime', nullable: true, select: false })
  refreshTokenExpiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
