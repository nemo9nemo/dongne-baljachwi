-- ============================================================================
-- 역 마스터: lines / stations / station_lines / 교정·원문·설정 테이블
--
-- 근거: docs/specs/02-station-master.md §4 (F-01~F-15)
--       docs/specs/00-data-model.md §4.8 (D-11)
--
-- 이 세 테이블은 커플 데이터가 아니다 — couple_id 가 없고 로그인 사용자 전원에게 열려 있다.
-- 격리 대상은 "이 커플이 어느 역에 갔는가"(records)이지 "역이 존재하는가"가 아니다 (02 §4.7).
--
-- 규모: 수도권 약 700행, 전국으로 넓혀도 1,073행. 클라이언트가 전량을 받아 로컬 캐시하는
-- 것이 기본 접근 패턴이므로(02 §6) 조회용 보조 인덱스를 늘리지 않았다. 유니크 제약이
-- 만드는 인덱스로 배치의 단건 조회까지 충분히 커버된다.
--
-- 도식(SVG) 좌표는 이 테이블들의 관할이 아니다 (F-14, ADR-003). 여기에는 실좌표만 둔다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- lines (02 §4.1)
-- ----------------------------------------------------------------------------

create table public.lines (
  id           uuid        primary key default gen_random_uuid(),
  code         text        not null unique,           -- 원천 노선번호 기반 (L-1001 등)
  name         text        not null,
  operator     text,
  -- F-08: 셀렉트박스 정렬 순서를 데이터가 정한다. 프론트에 순서 하드코딩 금지 (AC-12).
  sort_order   smallint    not null default 0,
  -- 색상값이 아니라 디자인 토큰 이름(line-2 등). 실제 색은 src/styles/tokens.css 소유.
  color_token  text        not null,
  -- F-10: MVP 범위(커버리지 % 분모, 안 가본 역 추천 후보)를 데이터가 정한다.
  in_mvp_scope boolean     not null default true,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.lines is
  '노선 마스터. 쓰기는 service_role 배치만 (02 §4.7).';

create trigger lines_set_updated_at
  before update on public.lines
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- stations (02 §4.2)
-- ----------------------------------------------------------------------------

create table public.stations (
  id                uuid             primary key default gen_random_uuid(),
  -- F-06: 그룹 내 최소 역번호에서 파생한 안정 키(S-<역번호>). 재적재해도 같은 역은 같은 code.
  code              text             not null unique,
  name              text             not null,       -- 표시명 원문 (총신대입구(이수))
  name_short        text             not null,       -- 노선도 라벨용, 괄호 부기 제거
  name_key          text             not null,       -- 그룹핑 비교용 정규화 키 (F-03)
  -- F-07: 그룹 내 노선별 좌표의 산술 평균. 좌표를 확보하지 못한 역은 적재하지 않는다
  -- (02 §4.2 "좌표 미확보 시 적재 보류") — 그래서 NOT NULL 이다.
  lat               double precision not null,
  lng               double precision not null,
  region_code       text             not null,       -- 시도 코드 11/41/28 ...
  -- station_lines 개수 >= 2 에서 파생되지만, 노선도/지도가 매번 집계하지 않도록 물리화했다.
  -- 배치가 적재 시 함께 계산해 채운다. 이 값이 틀어지면 환승 뱃지가 잘못 표시된다.
  is_transfer       boolean          not null default false,
  is_active         boolean          not null default true,
  needs_review      boolean          not null default false,  -- F-05 그룹핑 경고 대상
  source            text             not null,
  source_updated_on date,
  created_at        timestamptz      not null default now(),
  updated_at        timestamptz      not null default now(),

  constraint stations_source_valid check (source in ('tago', 'standard-file')),
  -- 원천 좌표가 뒤바뀌거나(위경도 스왑) 0,0 으로 들어오는 사고를 경계에서 잡는다.
  constraint stations_lat_range check (lat between -90 and 90),
  constraint stations_lng_range check (lng between -180 and 180)
);

comment on table public.stations is
  '물리 역 마스터. 환승역은 여기 1행 + station_lines N행 (02 F-01). 삭제하지 않고 is_active=false 로만 내린다.';

create trigger stations_set_updated_at
  before update on public.stations
  for each row execute function public.set_updated_at();

-- 접근 패턴: 배치의 그룹핑/재적재가 name_key 로 후보를 찾고, 역 검색 UI도 같은 키를 쓴다.
create index stations_name_key_idx on public.stations (name_key);

-- ----------------------------------------------------------------------------
-- station_lines (02 §4.3)
-- ----------------------------------------------------------------------------

create table public.station_lines (
  station_id uuid             not null references public.stations (id) on delete cascade,
  line_id    uuid             not null references public.lines (id)    on delete cascade,
  station_no text,                                    -- 노선별 역번호 ("239")
  -- F-11: 노선 내 순서. 노선도 선 연결과 추천 근접도 계산의 기준.
  seq        int              not null,
  -- 그룹 대표 좌표(F-07) 재계산의 원본. stations.lat/lng 와 중복이 아니라 입력값이다.
  lat        double precision not null,
  lng        double precision not null,

  primary key (station_id, line_id),

  -- 한 노선 안에서 순서가 겹치면 노선도 선이 갈라진다. DB가 막는다.
  -- 이 유니크 인덱스가 곧 "노선 하나를 순서대로 읽기" 쿼리의 인덱스이기도 하다.
  constraint station_lines_line_seq_unique unique (line_id, seq)
);

comment on table public.station_lines is
  '노선별 역. 홍대입구처럼 3개 노선이 지나면 3행 (02 AC-03).';

-- ----------------------------------------------------------------------------
-- station_merge_overrides (02 §4.4) — 자동 규칙보다 우선하는 수동 교정
-- ----------------------------------------------------------------------------

create table public.station_merge_overrides (
  id          uuid        primary key default gen_random_uuid(),
  kind        text        not null,
  -- 원천 역번호 목록. 배치가 그룹핑 직후 이 목록으로 강제 병합/분리한다.
  source_keys text[]      not null,
  reason      text        not null,   -- 왜 이렇게 정했는지 (사람이 읽는 기록)
  created_at  timestamptz not null default now(),

  constraint station_merge_overrides_kind_valid check (kind in ('merge', 'split')),
  constraint station_merge_overrides_keys_not_empty check (array_length(source_keys, 1) >= 2)
);

comment on table public.station_merge_overrides is
  'merge=규칙상 분리되지만 같은 역 / split=규칙상 묶이지만 다른 역. 자동 규칙(F-02)보다 우선한다 (F-04).';

-- ----------------------------------------------------------------------------
-- station_source_raw (02 §4.5, F-15)
-- ----------------------------------------------------------------------------

create table public.station_source_raw (
  id         bigint      generated always as identity primary key,
  fetched_at timestamptz not null default now(),
  source     text        not null,
  payload    jsonb       not null
);

comment on table public.station_source_raw is
  '원천 응답 원문 보관. 그룹핑 규칙을 바꿔 재계산할 때 API를 다시 때리지 않기 위해 (F-15).';

-- ----------------------------------------------------------------------------
-- app_settings (02 §4.6) — master_version
-- ----------------------------------------------------------------------------

create table public.app_settings (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is
  '앱 전역 설정. 지금은 master_version 한 행뿐이다 (02 §4.6).';

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- F-09: 클라이언트 캐시 무효화 신호. 배치가 없어도 앱 부팅이 실패하지 않도록 0으로 시드한다.
insert into public.app_settings (key, value)
values ('master_version', jsonb_build_object('version', 0, 'applied_at', null))
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- station_master_public (02 §6) — 클라이언트 전송용 축소 뷰
-- ----------------------------------------------------------------------------

-- 전송량 예산 gzip 150KB 이하를 맞추기 위해 클라이언트에 필요 없는 운영 컬럼
-- (name_key, source, needs_review, source_updated_on)을 잘라낸다. SELECT * 를 그대로
-- 노출하면 1,073행 × 불필요 4컬럼이 매 캐시 갱신마다 실려 나간다.
-- security_invoker=true: 뷰 기본값(definer)이면 stations 의 RLS를 우회한다 (D-12).
create view public.station_master_public
with (security_invoker = true) as
select
  s.id,
  s.code,
  s.name,
  s.name_short,
  s.lat,
  s.lng,
  s.region_code,
  s.is_transfer,
  s.is_active
from public.stations s;

comment on view public.station_master_public is
  '마스터 캐시 전송용 축소 뷰 (02 §6). 운영 전용 컬럼을 제외한다.';

-- ----------------------------------------------------------------------------
-- RLS (02 §4.7, D-11)
-- ----------------------------------------------------------------------------

alter table public.lines                   enable row level security;
alter table public.stations                enable row level security;
alter table public.station_lines           enable row level security;
alter table public.station_merge_overrides enable row level security;
alter table public.station_source_raw      enable row level security;
alter table public.app_settings            enable row level security;

-- 마스터 3종: 로그인 사용자 전원 읽기. 쓰기 정책은 만들지 않는다
-- = service_role(RLS 우회) 배치만 쓸 수 있다 (F-13, AC-09).
create policy lines_select_authenticated on public.lines
  for select to authenticated using (true);

create policy stations_select_authenticated on public.stations
  for select to authenticated using (true);

create policy station_lines_select_authenticated on public.station_lines
  for select to authenticated using (true);

revoke insert, update, delete, truncate on public.lines         from anon, authenticated;
revoke insert, update, delete, truncate on public.stations      from anon, authenticated;
revoke insert, update, delete, truncate on public.station_lines from anon, authenticated;
revoke all on public.lines         from anon;
revoke all on public.stations      from anon;
revoke all on public.station_lines from anon;

-- 명시적 권한 부여 (20260811120000_core_identity.sql 의 profiles 주석 참조).
-- 이게 없으면 새 Supabase 프로젝트에서 마스터 조회가 전부 42501 이 되어 노선도가 빈 화면이 된다.
grant select on public.lines, public.stations, public.station_lines to authenticated;

-- app_settings 는 지금 master_version 한 행뿐이지만, 나중에 운영용 설정이 들어와도
-- 자동으로 공개되지 않도록 키를 명시적으로 화이트리스트한다.
create policy app_settings_select_master_version on public.app_settings
  for select to authenticated using (key = 'master_version');

revoke insert, update, delete, truncate on public.app_settings from anon, authenticated;
revoke all on public.app_settings from anon;
-- 읽기는 정책이 master_version 한 행으로 좁힌다 (F-09 캐시 무효화 신호).
grant select on public.app_settings to authenticated;

-- 교정 규칙과 원문은 운영 데이터다. 정책 없음 + 권한 회수 = 클라이언트 조회 불가 (AC-10).
revoke all on public.station_merge_overrides from anon, authenticated;
revoke all on public.station_source_raw      from anon, authenticated;

-- 배치(service_role) 쓰기 권한 (D-11, F-13). service_role 은 RLS 를 우회하지만 **테이블 권한은
-- 우회하지 못한다** — 자동 노출이 없어진 지금은 이 GRANT 가 없으면 scripts/load-station-master.mjs
-- 가 조회/적재 첫 줄에서 42501 로 죽는다. 접근 패턴은 그 스크립트가 실제로 하는 것과 1:1이다:
-- 기존 마스터 조회 → 교정 규칙 조회 → 원문 적재 → apply_station_master(마스터 upsert + 버전 증가).
grant select, insert, update, delete on
  public.lines, public.stations, public.station_lines, public.app_settings
  to service_role;
grant select on public.station_merge_overrides to service_role;
grant insert on public.station_source_raw      to service_role;

-- 뷰는 security_invoker 라 stations 정책을 그대로 따른다. anon 은 정책 대상이 아니므로
-- 0행이지만, 권한 자체를 회수해 의도를 분명히 한다.
revoke all on public.station_master_public from anon;
grant select on public.station_master_public to authenticated;
