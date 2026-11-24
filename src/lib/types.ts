export type UserRole = "coach" | "admin";
export type BookingStatus = "confirmed" | "cancelled";
export type SportKind = "baseball" | "softball";
export type EventAttendancePolicy = "bookable" | "team_optional" | "fixed";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
};

export type Resource = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
};

export type AvailabilityWindow = {
  id: string;
  resource_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

export type BookingProfile = Pick<Profile, "full_name" | "email">;

export type Booking = {
  id: string;
  resource_id: string;
  coach_user_id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  notes: string | null;
  team_id?: string | null;
  /** Supabase embed may return object or (rarely) array depending on inference */
  profiles?: BookingProfile | BookingProfile[] | null;
};

export type ResourceBlock = {
  id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_by: string | null;
};

export type Team = {
  id: string;
  name: string;
  age_group: string;
  sport: SportKind;
  color: string | null;
  is_active: boolean;
};

export type ScheduleEventTeam = Pick<
  Team,
  "id" | "name" | "age_group" | "sport" | "color"
>;

export type ScheduleEvent = {
  id: string;
  resource_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  attendance_policy: EventAttendancePolicy;
  notes: string | null;
  booking_id: string | null;
  created_by: string | null;
  resources?: Pick<Resource, "id" | "slug" | "name"> | Pick<Resource, "id" | "slug" | "name">[] | null;
  schedule_event_teams?:
    | { team_id: string; teams: ScheduleEventTeam | ScheduleEventTeam[] | null }[]
    | null;
};
