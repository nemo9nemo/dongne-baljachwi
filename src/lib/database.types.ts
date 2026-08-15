/**
 * Supabase 스키마 타입 — **손으로 쓴 임시본**.
 *
 * Supabase 프로젝트가 아직 없어 `supabase gen types typescript`를 돌릴 수 없다.
 * 프로젝트가 생성되면 이 파일은 생성된 타입으로 통째로 교체한다.
 *
 * 근거 문서 (이 파일이 아니라 아래가 정본이다):
 * - `docs/specs/00-data-model.md` §4.1~4.5
 * - `docs/specs/01-auth-couple-link.md` §4.1~4.3
 *
 * 스키마와 어긋나는 게 발견되면 여기를 고치지 말고 스펙/백엔드와 먼저 맞춘다.
 *
 * 규칙:
 * - 클라이언트가 직접 쓰기(INSERT/UPDATE)할 수 없는 테이블은 `Record<string, never>`로 막아
 *   타입 단계에서 잘못된 호출이 걸리게 한다 (실제 차단은 RLS가 한다).
 * - `Relationships: []`인 이유: 이 라운드는 임베드 조회(`select('a, b(c)')`)를 쓰지 않는다.
 *   임베드가 필요해지면 그때 FK 정보를 채운다.
 */

/** `couples.status` (00 §4.2) */
export type CoupleStatus = 'active' | 'dissolved'

/** `couple_members.role` (00 §4.3) */
export type CoupleRole = 'owner' | 'partner'

/** `create_couple` 반환 (01 §4.3) */
export type CreateCoupleResult = {
  couple_id: string
  code: string
  expires_at: string
}

/** `issue_invite` 반환 (01 §4.3) */
export type IssueInviteResult = {
  code: string
  expires_at: string
}

/**
 * 실패 응답 봉투 (01 §4.4).
 *
 * 대부분의 함수는 이 모양을 **예외 메시지에 실어 던지지만**, `redeem_invite`만
 * 정상 반환값으로 돌려준다. 이유는 `couple-rpc.ts` 상단 주석 참조.
 */
export type RpcErrorEnvelope = {
  error_code: string
  message: string
  retry_after: number | null
}

/** `redeem_invite` **성공** 반환 (01 §4.3). 실패는 {@link RpcErrorEnvelope}로 온다 */
export type RedeemInviteResult = {
  couple_id: string
  partner_display_name: string
}

/** `dissolve_couple` 반환 (01 §4.3) */
export type DissolveCoupleResult = {
  dissolved_at: string
  purge_after: string
}

/**
 * `records.mood` 허용값 (00 §4.5 CHECK, 05 F-11).
 * 저장 값은 이모지가 아니라 이 영문 슬러그다 (05 F-14) — 이모지는 플랫폼마다 렌더가 다르고,
 * 표현을 DB에 넣으면 나중에 바꿀 수 없다.
 */
export type Mood = 'happy' | 'love' | 'excited' | 'calm' | 'sad'

/** `records.weather` 허용값 (00 §4.5 CHECK, 05 F-12) */
export type Weather = 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'windy'

/** `record_photos.content_type` 허용값 (00 §4.6 CHECK) */
export type PhotoContentType = 'image/jpeg' | 'image/png' | 'image/webp'

/** `upsert_record` 인자 (05 §4.2). 신규는 `p_record_id = null` */
export type UpsertRecordArgs = {
  p_record_id: string | null
  p_station_id: string
  /** `YYYY-MM-DD`. 미래 불가 — 상한은 클라이언트 로컬 날짜가 정한다 (00 D-13) */
  p_visited_on: string
  p_mood: Mood | null
  p_weather: Weather | null
  p_note: string | null
  /** 정규화 전 원문. 최대 10개. 서버가 다시 정규화한다 (00 §4.7) */
  p_tags: string[]
}

/** `upsert_record` **성공** 반환 (05 §4.2). 실패는 예외 봉투로 온다 */
export type UpsertRecordResult = {
  record_id: string
  created: boolean
  updated_at: string
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string
          created_at: string
          updated_at: string
        }
        // 트리거가 생성한다 (F-05). 클라이언트 INSERT/DELETE 금지.
        Insert: Record<string, never>
        Update: { display_name?: string }
        Relationships: []
      }
      couples: {
        Row: {
          id: string
          started_on: string
          status: CoupleStatus
          dissolved_at: string | null
          purge_after: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        // 생성/해제는 SECURITY DEFINER 함수로만 한다 (01 §4.3).
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
      couple_members: {
        Row: {
          couple_id: string
          user_id: string
          role: CoupleRole
          joined_at: string
        }
        // 멤버십은 인가의 뿌리다. 변경 경로는 함수뿐 (00 §4.3).
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
      couple_invites: {
        Row: {
          id: string
          couple_id: string
          code: string
          created_by: string
          expires_at: string
          consumed_at: string | null
          consumed_by: string | null
          revoked_at: string | null
          created_at: string
        }
        // 발급/무효화는 함수로만 (01 §4.1).
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
      records: {
        Row: {
          id: string
          couple_id: string
          station_id: string
          visited_on: string
          mood: Mood | null
          weather: Weather | null
          note: string | null
          author_id: string
          last_edited_by: string | null
          created_at: string
          updated_at: string
        }
        // 본문 쓰기는 반드시 upsert_record RPC를 거친다 (05 F-34: 본문+태그가 한 트랜잭션).
        // 직접 INSERT/UPDATE 경로를 타입 단계에서 막아 "태그만 빠진 절반짜리 기록"을 원천 차단한다.
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
      record_photos: {
        Row: {
          id: string
          record_id: string
          couple_id: string
          storage_path: string
          sort_order: number
          width: number
          height: number
          byte_size: number
          content_type: PhotoContentType
          created_at: string
        }
        // 사진만 RPC 밖이다 (05 §4.3): 업로드는 오래 걸려 트랜잭션에 넣을 수 없다.
        // `couple_id`는 트리거가 부모 records에서 복사하므로 클라이언트가 보내지 않는다.
        // `id`는 Storage 경로에 먼저 필요해서 클라이언트가 만든다 (05 §4.3 1단계).
        Insert: {
          id: string
          record_id: string
          storage_path: string
          sort_order: number
          width: number
          height: number
          byte_size: number
          content_type: PhotoContentType
        }
        // 순서 변경은 UPDATE가 아니라 삭제 후 재삽입이다 —
        // UNIQUE(record_id, sort_order) 때문에 제자리 교체가 유니크 충돌을 낸다.
        Update: Record<string, never>
        Relationships: []
      }
      record_tags: {
        Row: {
          record_id: string
          tag_norm: string
          couple_id: string
          tag: string
          created_at: string
        }
        // 태그 쓰기는 upsert_record 안에서만 일어난다 (05 F-34).
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
      station_lines: {
        // 05 F-09(검색 결과 호선 배지)에만 쓴다. 노선도는 이 테이블 없이 도식 좌표로 그린다.
        Row: {
          station_id: string
          line_id: string
          station_no: string | null
          seq: number
          lat: number
          lng: number
        }
        // 쓰기는 service_role 배치만 (02 §4.7).
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
      lines: {
        Row: {
          id: string
          code: string
          name: string
          operator: string | null
          sort_order: number
          /** 색상값이 아니라 토큰 **이름**이다 ("line-2"). 실제 색은 tokens.css 소유 (02 §4.1) */
          color_token: string
          in_mvp_scope: boolean
          is_active: boolean
        }
        // 쓰기는 service_role 배치만 (02 §4.7).
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
      // stations / station_lines 는 클라이언트가 직접 읽지 않는다.
      // 노선도·지도는 축소 뷰 station_master_public 으로만 접근한다 (02 §6).
      app_settings: {
        Row: { key: string; value: unknown; updated_at: string }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
    }
    Views: {
      /** 마스터 캐시 전송용 축소 뷰 (02 §6) */
      station_master_public: {
        Row: {
          id: string
          code: string
          name: string
          name_short: string
          lat: number
          lng: number
          region_code: string
          is_transfer: boolean
          is_active: boolean
        }
        Relationships: []
      }
      /** 커플별 역 방문 집계 (00 §4.9). RLS로 내 커플 행만 온다 (03 §4.4) */
      couple_station_visits: {
        Row: {
          couple_id: string
          station_id: string
          visit_count: number
          first_visited_on: string
          last_visited_on: string
        }
        Relationships: []
      }
      /** 커플별 태그 사용 집계 (00 §4.9). 05 F-28 태그 자동완성 소스 */
      couple_tag_usage: {
        Row: {
          couple_id: string
          tag_norm: string
          usage_count: number
          /** 가장 최근에 쓴 표기. 같은 tag_norm에 "Cafe"/"cafe"가 섞여도 칩 표기가 흔들리지 않게 */
          tag: string
        }
        Relationships: []
      }
    }
    Functions: {
      // 아래 셋은 실패 시 예외를 던지므로 Returns는 성공 모양뿐이다.
      create_couple: {
        Args: { p_started_on: string; p_display_name: string }
        Returns: CreateCoupleResult
      }
      issue_invite: {
        Args: Record<string, never>
        Returns: IssueInviteResult
      }
      // redeem_invite만 실패도 200 응답으로 온다. 호출부가 반드시 좁혀야 하도록 union으로 둔다.
      redeem_invite: {
        Args: { p_code: string; p_display_name: string }
        Returns: RedeemInviteResult | RpcErrorEnvelope
      }
      dissolve_couple: {
        Args: { p_confirm: string }
        Returns: DissolveCoupleResult
      }
      /**
       * 05 §4.2. 본문+태그를 한 트랜잭션으로 저장한다. 실패는 예외 봉투(경로 A).
       *
       * ⚠️ 인자 이름은 스펙 §4.2의 `record_id/station_id/...`에 `p_` 접두사를 붙인 형태로
       * 가정했다. 기존 SQL 함수 넷이 모두 `p_` 접두사를 쓰므로 같은 규칙을 따랐다.
       * **백엔드 구현과 이름이 다르면 호출 자체가 404로 실패하므로 먼저 맞춰야 한다.**
       */
      upsert_record: {
        Args: UpsertRecordArgs
        Returns: UpsertRecordResult
      }
    }
  }
}
