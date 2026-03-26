import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class TrackVisitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  clientKey: string;
}
