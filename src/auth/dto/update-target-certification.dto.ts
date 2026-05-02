import { IsOptional, IsString } from 'class-validator';

// 로그인한 사용자의 목표 자격증 수정 요청을 검증하는 DTO입니다.
export class UpdateTargetCertificationDto {
  @IsOptional()
  @IsString()
  targetCertificationType?: string | null;
}
