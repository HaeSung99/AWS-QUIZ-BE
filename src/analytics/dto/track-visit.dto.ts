import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export type VisitEventType =
  | 'page_view'
  | 'dwell_5s'
  | 'scroll'
  | 'click'
  | 'search_input'
  | 'quiz_enter'
  | 'answer_select'
  | 'quiz_submit'
  | 'login';

export class TrackVisitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  clientKey: string;

  @IsOptional()
  @IsIn([
    'page_view',
    'dwell_5s',
    'scroll',
    'click',
    'search_input',
    'quiz_enter',
    'answer_select',
    'quiz_submit',
    'login',
  ])
  eventType?: VisitEventType;

  @IsOptional()
  @IsBoolean()
  isLoggedIn?: boolean;
}
