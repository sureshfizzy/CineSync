export interface MediaDetailsData {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  episode_run_time?: number[];
  genres?: { id: number; name: string }[];
  tagline?: string;
  vote_average?: number;
  vote_count?: number;
  status?: string;
  original_language?: string;
  production_countries?: { name: string }[];
  budget?: number;
  revenue?: number;
  credits?: {
    cast: { 
      id: number; 
      name: string; 
      character: string; 
      profile_path: string | null;
    }[];
    crew: { 
      id: number; 
      name: string; 
      job: string;
    }[];
  };
  keywords?: { name: string }[];
  media_type?: string;
  seasons?: {
    air_date: string;
    episode_count: number;
    id: number;
    name: string;
    overview: string;
    poster_path: string;
    season_number: number;
    episodes?: {
      air_date: string;
      episode_number: number;
      id: number;
      name: string;
      overview: string;
      production_code: string;
      season_number: number;
      still_path: string;
      vote_average: number;
      vote_count: number;
      runtime?: number;
      crew?: { id: number; name: string; job: string; profile_path: string | null }[];
      guest_stars?: { id: number; name: string; character: string; profile_path: string | null }[];
    }[];
  }[];
} 